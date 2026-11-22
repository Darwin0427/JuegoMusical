-- Rachas, estadísticas por jugador y puntaje aplicado al REVELAR
-- (antes el puntaje subía al responder y delataba quién acertó en plena ronda)

alter table public.players
  add column streak         int    not null default 0,
  add column best_streak    int    not null default 0,
  add column correct_count  int    not null default 0,
  add column answered_count int    not null default 0,
  add column total_ms       bigint not null default 0;

alter table public.answers add column bonus int not null default 0;

-- Bonus de racha: desde el 3er acierto seguido
create or replace function public._streak_bonus(p_new_streak int)
returns int language sql immutable as $$ select case when p_new_streak >= 3 then 150 else 0 end $$;

create or replace function public.submit_answer(p_token uuid, p_round_id uuid, p_choice int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_player players; v_round rounds; v_room rooms; v_secret round_secrets;
  v_correct boolean; v_points int := 0; v_total numeric; v_left numeric;
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
  if exists (select 1 from answers where round_id = p_round_id and player_id = v_player.id) then
    raise exception 'Ya respondiste esta ronda';
  end if;
  if p_choice < 0 or p_choice > 3 then raise exception 'Opción no válida'; end if;

  select * into v_secret from round_secrets where round_id = p_round_id;
  v_correct := (p_choice = v_secret.correct_index);
  if v_correct then
    v_total := extract(epoch from (v_round.ends_at - v_round.starts_at));
    v_left  := greatest(0, extract(epoch from (v_round.ends_at - now())));
    v_points := 500 + round(500 * v_left / v_total);
  end if;

  insert into answers(round_id, player_id, choice, is_correct, points)
    values (p_round_id, v_player.id, p_choice, v_correct, v_points);
  -- Solo se marca que respondió; el puntaje se suma al revelar
  update players set answered_round = v_round.round_number where id = v_player.id;

  if (select count(*) from answers where round_id = p_round_id)
     >= (select count(*) from players where room_id = v_round.room_id) then
    update rounds set ends_at = now() where id = p_round_id;
  end if;

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.advance(p_token uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_player players; v_room rooms; v_round rounds; v_secret round_secrets;
begin
  v_player := _player_from_token(p_token);
  if v_player.id is null then raise exception 'Jugador no válido'; end if;
  select * into v_room from rooms where id = v_player.room_id for update;
  if v_room.status <> 'playing' then return v_room.status; end if;

  select * into v_round from rounds where room_id = v_room.id and round_number = v_room.current_round;

  if v_round.revealed_at is null then
    if now() >= v_round.ends_at then
      select * into v_secret from round_secrets where round_id = v_round.id;
      update rounds set revealed_at = now(), correct_index = v_secret.correct_index, answer = v_secret.answer
       where id = v_round.id;

      -- Bonus de racha (con la racha que traían antes de esta ronda)
      update answers a set bonus = _streak_bonus(p.streak + 1)
        from players p
       where a.round_id = v_round.id and p.id = a.player_id and a.is_correct;

      -- Aplicar puntaje y estadísticas a todos los jugadores de la sala
      update players p set
        score          = p.score + coalesce(s.points, 0) + coalesce(s.bonus, 0),
        streak         = case when s.is_correct then p.streak + 1 else 0 end,
        best_streak    = greatest(p.best_streak, case when s.is_correct then p.streak + 1 else 0 end),
        correct_count  = p.correct_count + case when s.is_correct then 1 else 0 end,
        answered_count = p.answered_count + case when s.answered_at is not null then 1 else 0 end,
        total_ms       = p.total_ms + coalesce(greatest(0, round(extract(epoch from (s.answered_at - v_round.starts_at)) * 1000))::bigint, 0)
      from (
        select p2.id as pid, a.is_correct, a.points, a.bonus, a.answered_at
          from players p2
          left join answers a on a.player_id = p2.id and a.round_id = v_round.id
         where p2.room_id = v_room.id
      ) s
      where p.id = s.pid;
      return 'revealed';
    end if;
    return 'waiting';
  end if;

  if now() >= v_round.revealed_at + interval '5 seconds' then
    if v_room.current_round >= v_room.total_rounds then
      update rooms set status = 'finished', updated_at = now() where id = v_room.id;
      return 'finished';
    end if;
    update rounds set starts_at = now() + interval '2 seconds',
                      ends_at   = now() + interval '2 seconds' + make_interval(secs => v_room.round_seconds)
     where room_id = v_room.id and round_number = v_room.current_round + 1;
    update rooms set current_round = current_round + 1, updated_at = now() where id = v_room.id;
    return 'next';
  end if;
  return 'waiting';
end $$;

create or replace function public.start_game(
  p_token uuid, p_rounds jsonb, p_source_type text, p_source_label text, p_round_seconds int default 20)
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

  delete from rounds where room_id = v_room.id;
  update players set score = 0, answered_round = 0, streak = 0, best_streak = 0,
                     correct_count = 0, answered_count = 0, total_ms = 0
   where room_id = v_room.id;

  for r in select * from jsonb_array_elements(p_rounds) loop
    n := n + 1;
    insert into rounds(room_id, round_number, preview_url, options)
      values (v_room.id, n, r->>'preview_url', r->'options') returning id into v_round_id;
    insert into round_secrets(round_id, correct_index, answer)
      values (v_round_id, (r->>'correct_index')::int, r->'answer');
  end loop;

  update rounds set starts_at = now() + interval '4 seconds',
                    ends_at   = now() + interval '4 seconds' + make_interval(secs => greatest(10, least(p_round_seconds, 40)))
   where room_id = v_room.id and round_number = 1;

  update rooms set status = 'playing', total_rounds = n, current_round = 1,
                   source_type = p_source_type, source_label = left(p_source_label, 80),
                   round_seconds = greatest(10, least(p_round_seconds, 40)), updated_at = now()
   where id = v_room.id;
end $$;

drop function if exists public.round_results(uuid);
create function public.round_results(p_round_id uuid)
returns table(player_id uuid, choice int, is_correct boolean, points int, bonus int, time_ms int)
language sql stable security definer set search_path = public as $$
  select a.player_id, a.choice, a.is_correct, a.points, a.bonus,
         greatest(0, round(extract(epoch from (a.answered_at - r.starts_at)) * 1000))::int
    from answers a join rounds r on r.id = a.round_id
   where a.round_id = p_round_id and r.revealed_at is not null;
$$;
grant execute on function public.round_results(uuid) to anon, authenticated;
revoke execute on function public._streak_bonus(int) from public, anon, authenticated;
