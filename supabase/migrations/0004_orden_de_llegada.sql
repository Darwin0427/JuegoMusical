-- Orden de llegada exacto: si dos jugadores entran "a la vez", el heredero del anfitrión
-- debe ser siempre el mismo. now() es la hora de inicio de la transacción (puede empatar);
-- clock_timestamp() es la hora real, y el id desempata de forma estable.
alter table public.players alter column joined_at set default clock_timestamp();

create or replace function public.leave_room(p_token uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_player players; v_next uuid;
begin
  v_player := _player_from_token(p_token);
  if v_player.id is null then return; end if;
  delete from players where id = v_player.id;
  if exists (select 1 from rooms where id = v_player.room_id and host_player_id is null) then
    select id into v_next from players where room_id = v_player.room_id order by joined_at, id limit 1;
    if v_next is null then
      delete from rooms where id = v_player.room_id;
    else
      update rooms set host_player_id = v_next, updated_at = now() where id = v_player.room_id;
    end if;
  end if;
end $$;
