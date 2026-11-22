-- Juego musical multijugador (blind test)
-- Todo el estado del juego vive aquí. Los clientes solo LEEN tablas públicas
-- y MODIFICAN a través de funciones (RPC) que validan el token del jugador.

create extension if not exists pgcrypto;

-- ───────────── Tablas públicas (lectura por realtime) ─────────────

create table public.rooms (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  host_player_id  uuid,
  status          text not null default 'lobby' check (status in ('lobby','playing','finished')),
  is_public       boolean not null default false,
  source_type     text check (source_type in ('genre','playlist','artist')),
  source_label    text,
  total_rounds    int not null default 0,
  current_round   int not null default 0,
  round_seconds   int not null default 20,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.players (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  nickname        text not null check (char_length(nickname) between 1 and 20),
  score           int not null default 0,
  answered_round  int not null default 0,   -- última ronda respondida (para mostrar "ya respondió")
  joined_at       timestamptz not null default now()
);
create index players_room_idx on public.players(room_id);

alter table public.rooms
  add constraint rooms_host_fk foreign key (host_player_id) references public.players(id) on delete set null;

create table public.rounds (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.rooms(id) on delete cascade,
  round_number    int not null,
  preview_url     text not null,
  options         jsonb not null,           -- [{title, artist}] x4
  starts_at       timestamptz,
  ends_at         timestamptz,
  revealed_at     timestamptz,
  correct_index   int,                      -- null hasta revelar
  answer          jsonb,                    -- {title, artist, cover, link} null hasta revelar
  unique (room_id, round_number)
);

-- ───────────── Tablas privadas (sin acceso desde el cliente) ─────────────

create table public.player_secrets (
  player_id  uuid primary key references public.players(id) on delete cascade,
  token      uuid not null default gen_random_uuid()
);

create table public.round_secrets (
  round_id       uuid primary key references public.rounds(id) on delete cascade,
  correct_index  int not null,
  answer         jsonb not null
);

create table public.answers (
  round_id     uuid not null references public.rounds(id) on delete cascade,
  player_id    uuid not null references public.players(id) on delete cascade,
  choice       int not null,
  is_correct   boolean not null,
  points       int not null,
  answered_at  timestamptz not null default now(),
  primary key (round_id, player_id)
);

-- ───────────── Seguridad ─────────────

alter table public.rooms          enable row level security;
alter table public.players        enable row level security;
alter table public.rounds         enable row level security;
alter table public.player_secrets enable row level security;
alter table public.round_secrets  enable row level security;
alter table public.answers        enable row level security;

create policy rooms_read   on public.rooms   for select to anon, authenticated using (true);
create policy players_read on public.players for select to anon, authenticated using (true);
create policy rounds_read  on public.rounds  for select to anon, authenticated using (true);
-- player_secrets, round_secrets, answers: sin políticas => inaccesibles para anon.

revoke insert, update, delete on public.rooms, public.players, public.rounds from anon, authenticated;
revoke all on public.player_secrets, public.round_secrets, public.answers from anon, authenticated;

-- ───────────── Utilidades internas ─────────────

create or replace function public._player_from_token(p_token uuid)
returns public.players
language sql stable security definer set search_path = public as $$
  select p.* from players p join player_secrets s on s.player_id = p.id where s.token = p_token;
$$;
revoke execute on function public._player_from_token(uuid) from public, anon, authenticated;

create or replace function public._new_code()
returns text language plpgsql security definer set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..5 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from rooms where code = c);
  end loop;
  return c;
end $$;
revoke execute on function public._new_code() from public, anon, authenticated;

-- ───────────── Funciones del juego (RPC) ─────────────

-- Crear sala: devuelve el código y el token secreto del host
create or replace function public.create_room(p_nickname text, p_is_public boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room rooms; v_player players; v_token uuid;
begin
  p_nickname := btrim(coalesce(p_nickname, ''));
  if char_length(p_nickname) < 1 or char_length(p_nickname) > 20 then
    raise exception 'El apodo debe tener entre 1 y 20 caracteres';
  end if;
  insert into rooms(code, is_public) values (_new_code(), coalesce(p_is_public, false)) returning * into v_room;
  insert into players(room_id, nickname) values (v_room.id, p_nickname) returning * into v_player;
  insert into player_secrets(player_id) values (v_player.id) returning token into v_token;
  update rooms set host_player_id = v_player.id where id = v_room.id;
  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'player_id', v_player.id, 'token', v_token);
end $$;

-- Unirse con código
create or replace function public.join_room(p_code text, p_nickname text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_room rooms; v_player players; v_token uuid;
begin
  p_nickname := btrim(coalesce(p_nickname, ''));
  if char_length(p_nickname) < 1 or char_length(p_nickname) > 20 then
    raise exception 'El apodo debe tener entre 1 y 20 caracteres';
  end if;
  select * into v_room from rooms where code = upper(btrim(p_code));
  if not found then raise exception 'No existe una sala con ese código'; end if;
  if v_room.status = 'finished' and v_room.updated_at < now() - interval '2 hours' then
    raise exception 'Esa sala ya terminó';
  end if;
  if (select count(*) from players where room_id = v_room.id) >= 12 then
    raise exception 'La sala está llena (máximo 12 jugadores)';
  end if;
  if exists (select 1 from players where room_id = v_room.id and lower(nickname) = lower(p_nickname)) then
    raise exception 'Ya hay alguien con ese apodo en la sala';
  end if;
  insert into players(room_id, nickname) values (v_room.id, p_nickname) returning * into v_player;
  insert into player_secrets(player_id) values (v_player.id) returning token into v_token;
  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'player_id', v_player.id, 'token', v_token);
end $$;

-- Salir de la sala (si sale el host, pasa a otro jugador)
create or replace function public.leave_room(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_player players; v_next uuid;
begin
  v_player := _player_from_token(p_token);
  if v_player.id is null then return; end if;
  delete from players where id = v_player.id;
  if exists (select 1 from rooms where id = v_player.room_id and host_player_id is null) then
    select id into v_next from players where room_id = v_player.room_id order by joined_at limit 1;
    if v_next is null then
      delete from rooms where id = v_player.room_id;
    else
      update rooms set host_player_id = v_next, updated_at = now() where id = v_player.room_id;
    end if;
  end if;
end $$;

-- Iniciar partida (solo el host). Lo llama el servidor con las rondas ya armadas.
-- p_rounds: [{preview_url, options:[{title,artist}], correct_index, answer:{title,artist,cover,link}}]
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
  update players set score = 0, answered_round = 0 where room_id = v_room.id;

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

-- Responder. Puntos: 500 por acertar + hasta 500 según rapidez.
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
  update players set score = score + v_points, answered_round = v_round.round_number where id = v_player.id;

  -- Si ya respondieron todos, se cierra la ronda
  if (select count(*) from answers where round_id = p_round_id)
     >= (select count(*) from players where room_id = v_round.room_id) then
    update rounds set ends_at = now() where id = p_round_id;
  end if;

  return jsonb_build_object('ok', true);
end $$;

-- Avanzar el juego. Cualquier jugador de la sala puede llamarla; es idempotente.
-- ronda terminada -> revelar respuesta; 5 s después -> siguiente ronda o fin.
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

-- Volver al lobby después de terminar (solo host)
create or replace function public.back_to_lobby(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_player players;
begin
  v_player := _player_from_token(p_token);
  if v_player.id is null then raise exception 'Jugador no válido'; end if;
  update rooms set status = 'lobby', current_round = 0, total_rounds = 0, updated_at = now()
   where id = v_player.room_id and host_player_id = v_player.id and status = 'finished';
  delete from rounds where room_id = v_player.room_id
    and exists (select 1 from rooms where id = v_player.room_id and status = 'lobby');
end $$;

-- Resultados de una ronda (solo después de revelar)
create or replace function public.round_results(p_round_id uuid)
returns table(player_id uuid, choice int, is_correct boolean, points int)
language sql stable security definer set search_path = public as $$
  select a.player_id, a.choice, a.is_correct, a.points
    from answers a join rounds r on r.id = a.round_id
   where a.round_id = p_round_id and r.revealed_at is not null;
$$;

-- Salas públicas abiertas
create or replace function public.list_public_rooms()
returns table(code text, host text, players bigint, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.code, h.nickname, (select count(*) from players p where p.room_id = r.id), r.created_at
    from rooms r left join players h on h.id = r.host_player_id
   where r.is_public and r.status = 'lobby' and r.updated_at > now() - interval '2 hours'
   order by r.created_at desc limit 30;
$$;

grant execute on function
  public.create_room(text, boolean), public.join_room(text, text), public.leave_room(uuid),
  public.start_game(uuid, jsonb, text, text, int), public.submit_answer(uuid, uuid, int),
  public.advance(uuid), public.back_to_lobby(uuid), public.round_results(uuid), public.list_public_rooms()
  to anon, authenticated;

-- ───────────── Realtime ─────────────
alter publication supabase_realtime add table public.rooms, public.players, public.rounds;

-- Hora del servidor (para sincronizar relojes de los clientes)
create or replace function public.server_now() returns timestamptz language sql stable set search_path = public as $$ select now() $$;
grant execute on function public.server_now() to anon, authenticated;

-- Resultados con tiempo de respuesta (ms desde el inicio de la ronda)
drop function if exists public.round_results(uuid);
create function public.round_results(p_round_id uuid)
returns table(player_id uuid, choice int, is_correct boolean, points int, time_ms int)
language sql stable security definer set search_path = public as $$
  select a.player_id, a.choice, a.is_correct, a.points,
         greatest(0, round(extract(epoch from (a.answered_at - r.starts_at)) * 1000))::int
    from answers a join rounds r on r.id = a.round_id
   where a.round_id = p_round_id and r.revealed_at is not null;
$$;
grant execute on function public.round_results(uuid) to anon, authenticated;
