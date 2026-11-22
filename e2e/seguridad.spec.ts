import { expect, test } from "@playwright/test";
import { createRoom, newPlayer, rest } from "./helpers";

// Lo que podría intentar un tramposo con la clave pública (visible en el navegador)
test("la API pública no deja ver respuestas, tokens ni cambiar puntajes", async ({ browser }) => {
  const host = await newPlayer(browser, "Darwin");
  const code = await createRoom(host);
  const room = ((await rest(`rooms?code=eq.${code}&select=id,host_player_id`)).body as { id: string; host_player_id: string }[])[0];
  expect(room.id).toBeTruthy();

  for (const t of ["round_secrets", "player_secrets", "answers"]) {
    const r = await rest(`${t}?select=*`);
    expect(r.status, `${t} debe estar bloqueada`).toBeGreaterThanOrEqual(400);
  }
  const patch = await rest(`players?id=eq.${room.host_player_id}`, { method: "PATCH", body: JSON.stringify({ score: 99999 }) });
  expect(patch.status).toBeGreaterThanOrEqual(400);
  const ins = await rest("rooms", { method: "POST", body: JSON.stringify({ code: "HACK1" }) });
  expect(ins.status).toBeGreaterThanOrEqual(400);
  const del = await rest(`rooms?id=eq.${room.id}`, { method: "DELETE" });
  expect(del.status).toBeGreaterThanOrEqual(400);

  const fake = await rest("rpc/start_game", { method: "POST", body: JSON.stringify({ p_token: "00000000-0000-0000-0000-000000000000", p_rounds: [], p_source_type: "genre", p_source_label: "x" }) });
  expect(fake.status).toBe(400);
  const internal = await rest("rpc/_player_from_token", { method: "POST", body: JSON.stringify({ p_token: room.host_player_id }) });
  expect(internal.status).toBeGreaterThanOrEqual(400);

  const still = ((await rest(`players?id=eq.${room.host_player_id}&select=score`)).body as { score: number }[])[0];
  expect(still.score).toBe(0);
  await host.ctx.close();
});
