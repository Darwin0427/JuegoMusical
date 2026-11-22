-- Modos de juego: qué adivinar (canción/artista), cómo responder (opciones/escribiendo),
-- fragmento desde una parte al azar, y comparación tolerante a errores de ortografía.

create extension if not exists unaccent with schema extensions;
create extension if not exists fuzzystrmatch with schema extensions;

alter table public.rooms
  add column answer_mode text not null default 'choice' check (answer_mode in ('choice','typed')),
  add column target      text not null default 'song'   check (target in ('song','artist'));

alter table public.rounds add column start_offset int not null default 0;

alter table public.answers
  add column text_answer text,
  add column attempts    int not null default 1;

-- Normaliza un título o nombre: sin tildes, minúsculas, sin paréntesis, "feat." ni "- remix", solo letras y números.
create or replace function public._norm(p text)
returns text language sql stable set search_path = public, extensions as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(lower(extensions.unaccent(coalesce(p, ''))), '\s*[\(\[].*?[\)\]]', '', 'g'),
             '\s+-\s+.*$', ''),
           '\s(feat|ft)\.?\s.*$', ''),
         '[^a-z0-9]+', ' ', 'g'));
$$;

-- ¿Se parece lo suficiente? Igual, o a pocas letras de distancia (1 cada 5 letras).
-- Para artistas con varios nombres ("Karol G & Nicki Minaj") vale cualquiera.
create or replace function public._close_enough(p_guess text, p_target text)
returns boolean language plpgsql stable set search_path = public, extensions as $$
declare g text := _norm(p_guess); t text; part text;
begin
  if g = '' then return false; end if;
  foreach part in array regexp_split_to_array(coalesce(p_target, ''), '\s*(,|&| y | x | and | feat\.? | ft\.? )\s*', 'i') || array[p_target] loop
    t := _norm(part);
    if t = '' then continue; end if;
    if g = t or replace(g, ' ', '') = replace(t, ' ', '') then return true; end if;
    if length(t) >= 4 and extensions.levenshtein(left(g, 255), left(t, 255)) <= greatest(1, floor(length(t) / 5.0)) then
      return true;
    end if;
  end loop;
  return false;
end $$;
revoke execute on function public._norm(text), public._close_enough(text, text) from public, anon, authenticated;

-- Iniciar partida con las opciones de modo
drop function if exists public.start_game(uuid, jsonb, text, text, int);
create function public.start_game(
  p_token uuid, p_rounds jsonb, p_source_type text, p_source_label text, p_round_seconds int default 20,
  p_answer_mode text default 'choice', p_target text default 'song')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_player players; v_room rooms; v_round_id uuid; r jsonb; n int := 0;
begin
  v_player := _player_from_token(p_token);
  if v_player.id is null then raise exception 'Jugador no válido'; end if;
  select * into v_room from rooms where id = v_player.room_id for update;
  if v_room.host_player_id <> v_player.id then raise exception 'Solo el anfitrión puede iniciar'; end if;
  if v_room.status = 'playing' then raise exception 'La partida ya está en curso'; end if;
  if jsonb_typeof(p_rounds) <> 'array' or jsonb_array_length(p_rounds) < 1 or jsonb_array_length(p_rounds) > 30 then
    raise exception 'Rondas no válidas';
  end if;
  if p_answer_mode not in ('choice','typed') or p_target not in ('song','artist') then
    raise exception 'Modo de juego no válido';
  end if;

  delete from rounds where room_id = v_room.id;
  update players set score = 0, answered_round = 0, streak = 0, best_streak = 0,
                     correct_count = 0, answered_count = 0, total_ms = 0
   where room_id = v_room.id;

  for r in select * from jsonb_array_elements(p_rounds) loop
    n := n + 1;
    insert into rounds(room_id, round_number, preview_url, options, start_offset)
      values (v_room.id, n, r->>'preview_url',
              case when p_answer_mode = 'typed' then '[]'::jsonb else r->'options' end,  -- escribiendo: sin opciones públicas
              greatest(0, least(coalesce((r->>'start_offset')::int, 0), 25)))
      returning id into v_round_id;
    insert into round_secrets(round_id, correct_index, answer)
      values (v_round_id, coalesce((r->>'correct_index')::int, -1), r->'answer');
  end loop;

  update rounds set starts_at = now() + interval '4 seconds',
                    ends_at   = now() + interval '4 seconds' + make_interval(secs => greatest(10, least(p_round_seconds, 40)))
   where room_id = v_room.id and round_number = 1;

  update rooms set status = 'playing', total_rounds = n, current_round = 1,
                   source_type = p_source_type, source_label = left(p_source_label, 80),
                   round_seconds = greatest(10, least(p_round_seconds, 40)),
                   answer_mode = p_answer_mode, target = p_target, updated_at = now()
   where id = v_room.id;
end $$;
grant execute on function public.start_game(uuid, jsonb, text, text, int, text, text) to anon, authenticated;

-- Responder: con opción (1 intento) o escribiendo (hasta 3 intentos)
drop function if exists public.submit_answer(uuid, uuid, int);
create function public.submit_answer(p_token uuid, p_round_id uuid, p_choice int default null, p_text text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_player players; v_round rounds; v_room rooms; v_secret round_secrets; v_prev answers;
  v_correct boolean; v_points int := 0; v_total numeric; v_left numeric; v_attempts int; v_done boolean;
begin
  v_player := _player_from_token(p_token);
  if v_player.id is null then raise exception 'Jugador no válido'; end if;
  select * into v_round from rounds where id = p_round_id for update;
  if v_round.room_id <> v_player.room_id then raise exception 'Ronda no válida'; end if;
  select * into v_room from rooms where id = v_round.room_id;
  if v_room.status <> 'playing' or v_room.current_round <> v_round.round_number then
    raise exception 'Esta ronda ya no está activa';
  end if;
  if now() < v_round.starts_at or now() > v_round.ends_at or v_round.revealed_at is not null then
    raise exception 'Fuera de tiempo';
  end if;

  select * into v_prev from answers where round_id = p_round_id and player_id = v_player.id;
  select * into v_secret from round_secrets where round_id = p_round_id;

  if v_room.answer_mode = 'typed' then
    p_text := btrim(coalesce(p_text, ''));
    if char_length(p_text) < 1 or char_length(p_text) > 80 then raise exception 'Escribe una respuesta'; end if;
    if v_prev.round_id is not null and (v_prev.is_correct or v_prev.attempts >= 3) then
      raise exception 'Ya respondiste esta ronda';
    end if;
    v_correct := _close_enough(p_text, v_secret.answer->>(case when v_room.target = 'artist' then 'artist' else 'title' end));
    v_attempts := coalesce(v_prev.attempts, 0) + 1;
  else
    if v_prev.round_id is not null then raise exception 'Ya respondiste esta ronda'; end if;
    if p_choice is null or p_choice < 0 or p_choice > 3 then raise exception 'Opción no válida'; end if;
    v_correct := (p_choice = v_secret.correct_index);
    v_attempts := 1;
  end if;

  if v_correct then
    v_total := extract(epoch from (v_round.ends_at - v_round.starts_at));
    v_left  := greatest(0, extract(epoch from (v_round.ends_at - now())));
    v_points := 500 + round(500 * v_left / v_total);
  end if;

  if v_prev.round_id is null then
    insert into answers(round_id, player_id, choice, is_correct, points, text_answer, attempts)
      values (p_round_id, v_player.id, coalesce(p_choice, -1), v_correct, v_points, nullif(p_text, ''), v_attempts);
  else
    update answers set is_correct = v_correct, points = v_points, text_answer = p_text,
                       attempts = v_attempts, answered_at = now()
     where round_id = p_round_id and player_id = v_player.id;
  end if;

  v_done := v_room.answer_mode = 'choice' or v_correct or v_attempts >= 3;
  if v_done then
    update players set answered_round = v_round.round_number where id = v_player.id;
  end if;

  -- Si ya terminaron todos, se cierra la ronda
  if (select count(*) from answers a where a.round_id = p_round_id
        and (v_room.answer_mode = 'choice' or a.is_correct or a.attempts >= 3))
     >= (select count(*) from players where room_id = v_round.room_id) then
    update rounds set ends_at = now() where id = p_round_id;
  end if;

  -- Escribiendo: el jugador sabe al instante si acertó (para reintentar); los demás no.
  return jsonb_build_object('ok', true,
    'correct', case when v_room.answer_mode = 'typed' then v_correct else null end,
    'attempts_left', case when v_room.answer_mode = 'typed' then greatest(0, 3 - v_attempts) else null end);
end $$;
grant execute on function public.submit_answer(uuid, uuid, int, text) to anon, authenticated;

-- Resultados con lo que escribió cada uno
drop function if exists public.round_results(uuid);
create function public.round_results(p_round_id uuid)
returns table(player_id uuid, choice int, is_correct boolean, points int, bonus int, time_ms int, text_answer text, attempts int)
language sql stable security definer set search_path = public as $$
  select a.player_id, a.choice, a.is_correct, a.points, a.bonus,
         greatest(0, round(extract(epoch from (a.answered_at - r.starts_at)) * 1000))::int,
         a.text_answer, a.attempts
    from answers a join rounds r on r.id = a.round_id
   where a.round_id = p_round_id and r.revealed_at is not null;
$$;
grant execute on function public.round_results(uuid) to anon, authenticated;
