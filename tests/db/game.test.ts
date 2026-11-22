import { describe, expect, it } from "vitest";
import { revealOver, round, row, rows, rpc, startedAgo, timeUp, setupDb, type Joined } from "./db";

const db = setupDb();

async function setup(n = 2, rounds = 3, mode: { answer?: string; target?: string; seconds?: number } = {}) {
  const host = await rpc<Joined>(db.c, "create_room", { p_nickname: "Darwin" });
  const guests: Joined[] = [];
  for (let i = 1; i < n; i++) guests.push(await rpc<Joined>(db.c, "join_room", { p_code: host.code, p_nickname: `Jugador${i}` }));
  await rpc(db.c, "start_game", {
    p_token: host.token,
    p_rounds: Array.from({ length: rounds }, (_, i) => round(i + 1, 1)),
    p_source_type: "genre",
    p_source_label: "Rap",
    p_round_seconds: mode.seconds ?? 20,
    p_answer_mode: mode.answer ?? "choice",
    p_target: mode.target ?? "song",
  });
  const roundId = async (num?: number) =>
    (await row<{ id: string }>(db.c, "select r.id from rounds r join rooms m on m.id = r.room_id where m.id = $1 and r.round_number = coalesce($2, m.current_round)", [host.room_id, num ?? null])).id;
  return { host, guests, all: [host, ...guests], roundId };
}

const answer = (p: Joined, roundId: string, choice: number) => rpc<{ ok: boolean }>(db.c, "submit_answer", { p_token: p.token, p_round_id: roundId, p_choice: choice });
const advance = (p: Joined) => rpc<string>(db.c, "advance", { p_token: p.token });
const score = async (p: Joined) => (await row<{ score: number }>(db.c, "select score from players where id = $1", [p.player_id])).score;
const player = (p: Joined) => row<Record<string, number>>(db.c, "select * from players where id = $1", [p.player_id]);

describe("start_game", () => {
  it("solo el anfitrión puede iniciar", async () => {
    const h = await rpc<Joined>(db.c, "create_room", { p_nickname: "Darwin" });
    const g = await rpc<Joined>(db.c, "join_room", { p_code: h.code, p_nickname: "Ana" });
    await expect(rpc(db.c, "start_game", { p_token: g.token, p_rounds: [round(1)], p_source_type: "genre", p_source_label: "x" })).rejects.toThrow(/Solo el anfitrión/);
    await expect(rpc(db.c, "start_game", { p_token: "00000000-0000-0000-0000-000000000000", p_rounds: [round(1)], p_source_type: "genre", p_source_label: "x" })).rejects.toThrow(/Jugador no válido/);
  });

  it("valida rondas (1 a 30) y modo de juego", async () => {
    const h = await rpc<Joined>(db.c, "create_room", { p_nickname: "Darwin" });
    const base = { p_token: h.token, p_source_type: "genre", p_source_label: "x" };
    await expect(rpc(db.c, "start_game", { ...base, p_rounds: [] })).rejects.toThrow(/Rondas no válidas/);
    await expect(rpc(db.c, "start_game", { ...base, p_rounds: Array.from({ length: 31 }, (_, i) => round(i)) })).rejects.toThrow(/Rondas no válidas/);
    await expect(rpc(db.c, "start_game", { ...base, p_rounds: { a: 1 } })).rejects.toThrow(/Rondas no válidas/);
    await expect(rpc(db.c, "start_game", { ...base, p_rounds: [round(1)], p_answer_mode: "voz" })).rejects.toThrow(/Modo de juego no válido/);
    await expect(rpc(db.c, "start_game", { ...base, p_rounds: [round(1)], p_target: "album" })).rejects.toThrow(/Modo de juego no válido/);
  });

  it("deja la sala jugando, ronda 1 empieza en 4 s y dura los segundos pedidos (10 a 40)", async () => {
    const { host } = await setup(1, 3, { seconds: 15 });
    const room = await row(db.c, "select status, current_round, total_rounds, round_seconds, source_label from rooms where id = $1", [host.room_id]);
    expect(room).toEqual({ status: "playing", current_round: 1, total_rounds: 3, round_seconds: 15, source_label: "Rap" });
    const r = await row<{ wait: number; len: number }>(
      db.c,
      "select extract(epoch from starts_at - now())::int as wait, extract(epoch from ends_at - starts_at)::int as len from rounds where room_id = $1 and round_number = 1",
      [host.room_id],
    );
    expect(r).toEqual({ wait: 4, len: 15 });
    expect(await rows(db.c, "select 1 from rounds where room_id = $1 and starts_at is null", [host.room_id])).toHaveLength(2); // las demás esperan
  });

  it("limita los segundos a 10..40 y el inicio del fragmento a 0..25", async () => {
    const h = await rpc<Joined>(db.c, "create_room", { p_nickname: "Darwin" });
    await rpc(db.c, "start_game", { p_token: h.token, p_rounds: [round(1, 1, { start_offset: 99 }), round(2, 1, { start_offset: -5 })], p_source_type: "genre", p_source_label: "x", p_round_seconds: 999 });
    expect((await row(db.c, "select round_seconds from rooms where id = $1", [h.room_id])).round_seconds).toBe(40);
    expect((await rows<{ start_offset: number }>(db.c, "select start_offset from rounds where room_id = $1 order by round_number", [h.room_id])).map((r) => r.start_offset)).toEqual([25, 0]);
  });

  it("la respuesta correcta NO queda en la tabla pública hasta revelar", async () => {
    const { host } = await setup();
    const pub = await rows(db.c, "select correct_index, answer from rounds where room_id = $1", [host.room_id]);
    expect(pub.every((r) => r.correct_index === null && r.answer === null)).toBe(true);
  });

  it("no se puede iniciar dos veces a la vez", async () => {
    const { host } = await setup();
    await expect(rpc(db.c, "start_game", { p_token: host.token, p_rounds: [round(1)], p_source_type: "genre", p_source_label: "x" })).rejects.toThrow(/ya está en curso/);
  });
});

describe("submit_answer (opciones)", () => {
  it("no se puede responder antes de que empiece la ronda", async () => {
    const { host, roundId } = await setup();
    await expect(answer(host, await roundId(), 1)).rejects.toThrow(/Fuera de tiempo/);
  });

  it("acertar da 500 + rapidez; fallar da 0; los puntos se suman AL REVELAR (no delatan a nadie)", async () => {
    const { host, guests, roundId } = await setup(3);
    await startedAgo(db.c, host.room_id, 3); // quedan 17 de 20 s
    const rid = await roundId();
    await answer(host, rid, 1);
    await answer(guests[0], rid, 0);
    expect(await score(host)).toBe(0);
    expect((await player(host)).answered_round).toBe(1); // sí se ve que ya respondió
    await timeUp(db.c, host.room_id);
    expect(await advance(guests[1])).toBe("revealed");
    expect(await score(host)).toBe(925); // 500 + 500 * 17/20
    expect(await score(guests[0])).toBe(0);
  });

  it("responder más rápido da más puntos", async () => {
    const { host, guests, roundId } = await setup(2);
    const rid = await roundId();
    await startedAgo(db.c, host.room_id, 1);
    await answer(host, rid, 1);
    await startedAgo(db.c, host.room_id, 15);
    await answer(guests[0], rid, 1);
    await advance(host);
    expect(await score(host)).toBeGreaterThan(await score(guests[0]));
    expect(await score(guests[0])).toBe(625); // 500 + 500 * 5/20
  });

  it("una sola respuesta por ronda y opción válida (0 a 3)", async () => {
    const { host, guests, roundId } = await setup(2);
    await startedAgo(db.c, host.room_id);
    const rid = await roundId();
    await expect(answer(host, rid, 4)).rejects.toThrow(/Opción no válida/);
    await expect(answer(host, rid, -1)).rejects.toThrow(/Opción no válida/);
    await expect(rpc(db.c, "submit_answer", { p_token: host.token, p_round_id: rid })).rejects.toThrow(/Opción no válida/);
    await answer(host, rid, 2);
    await expect(answer(host, rid, 1)).rejects.toThrow(/Ya respondiste/);
    await expect(answer(guests[0], rid, 1)).resolves.toBeTruthy();
  });

  it("no se puede responder después del tiempo, ni rondas futuras, ni de otra sala", async () => {
    const { host, roundId } = await setup(2);
    await startedAgo(db.c, host.room_id);
    await expect(answer(host, await roundId(2), 1)).rejects.toThrow(/ya no está activa/);
    const otra = await setup(1);
    await startedAgo(db.c, otra.host.room_id);
    await expect(answer(host, await otra.roundId(), 1)).rejects.toThrow(/Ronda no válida/);
    await timeUp(db.c, host.room_id);
    await expect(answer(host, await roundId(), 1)).rejects.toThrow(/Fuera de tiempo/);
  });

  it("cuando todos respondieron la ronda se cierra sola (no hay que esperar el tiempo)", async () => {
    const { host, guests, roundId } = await setup(3);
    await startedAgo(db.c, host.room_id);
    const rid = await roundId();
    await answer(host, rid, 1);
    await answer(guests[0], rid, 1);
    expect(await advance(host)).toBe("waiting"); // falta uno
    await answer(guests[1], rid, 0);
    expect(await advance(host)).toBe("revealed");
  });
});

describe("advance (el reloj del juego)", () => {
  it("espera mientras corre la ronda; revela al acabar; 5 s después pasa a la siguiente", async () => {
    const { host, guests } = await setup(2);
    await startedAgo(db.c, host.room_id);
    expect(await advance(host)).toBe("waiting");
    await timeUp(db.c, host.room_id);
    expect(await advance(guests[0])).toBe("revealed"); // cualquier jugador puede empujar
    expect(await advance(host)).toBe("waiting"); // revelado, esperando los 5 s
    await revealOver(db.c, host.room_id);
    expect(await advance(host)).toBe("next");
    const r = await row(db.c, "select current_round from rooms where id = $1", [host.room_id]);
    expect(r.current_round).toBe(2);
    const t = await row<{ wait: number; len: number }>(
      db.c,
      "select extract(epoch from starts_at - now())::int as wait, extract(epoch from ends_at - starts_at)::int as len from rounds where room_id = $1 and round_number = 2",
      [host.room_id],
    );
    expect(t).toEqual({ wait: 2, len: 20 });
  });

  it("es idempotente: varios jugadores empujando a la vez no se saltan rondas", async () => {
    const { host, guests } = await setup(3);
    await timeUp(db.c, host.room_id);
    const results = [await advance(host), await advance(guests[0]), await advance(guests[1])];
    expect(results).toEqual(["revealed", "waiting", "waiting"]);
    await revealOver(db.c, host.room_id);
    expect([await advance(host), await advance(guests[0])]).toEqual(["next", "waiting"]);
    expect((await row(db.c, "select current_round from rooms where id = $1", [host.room_id])).current_round).toBe(2);
  });

  it("al revelar copia la respuesta correcta a la tabla pública", async () => {
    const { host, roundId } = await setup();
    await timeUp(db.c, host.room_id);
    await advance(host);
    const r = await row(db.c, "select correct_index, answer, revealed_at from rounds where id = $1", [await roundId()]);
    expect(r.correct_index).toBe(1);
    expect(r.answer).toMatchObject({ title: "Respuesta 1" });
    expect(r.revealed_at).not.toBeNull();
  });

  it("tras la última ronda la partida termina", async () => {
    const { host } = await setup(1, 1);
    await timeUp(db.c, host.room_id);
    await advance(host);
    await revealOver(db.c, host.room_id);
    expect(await advance(host)).toBe("finished");
    expect(await advance(host)).toBe("finished");
    expect((await row(db.c, "select status from rooms where id = $1", [host.room_id])).status).toBe("finished");
  });

  it("en la sala de espera no hace nada", async () => {
    const h = await rpc<Joined>(db.c, "create_room", { p_nickname: "Darwin" });
    expect(await advance(h)).toBe("lobby");
  });
});

describe("rachas, bonus y estadísticas", () => {
  async function playRound(s: Awaited<ReturnType<typeof setup>>, picks: number[], ago: number[]) {
    const rid = await s.roundId();
    for (let i = 0; i < s.all.length; i++) {
      if (picks[i] === undefined) continue;
      await startedAgo(db.c, s.host.room_id, ago[i] ?? 2);
      await answer(s.all[i], rid, picks[i]);
    }
    await timeUp(db.c, s.host.room_id);
    expect(await advance(s.host)).toBe("revealed");
    const res = await rows(db.c, "select * from public.round_results($1)", [rid]);
    await revealOver(db.c, s.host.room_id);
    await advance(s.host);
    return res;
  }

  it("desde el 3.er acierto seguido suma +150; fallar o no responder rompe la racha", async () => {
    const s = await setup(2, 5);
    // Darwin acierta 4 seguidas y falla la 5.ª; Jugador1 acierta, no responde, acierta, acierta, acierta
    const r1 = await playRound(s, [1, 1], [2, 2]);
    await playRound(s, [1], [2]);
    const r3 = await playRound(s, [1, 1], [2, 2]);
    const r4 = await playRound(s, [1, 1], [2, 2]);
    await playRound(s, [0, 1], [2, 2]);
    expect(r1.every((r) => r.bonus === 0)).toBe(true);
    expect(r3.find((r) => r.player_id === s.host.player_id)!.bonus).toBe(150);
    expect(r3.find((r) => r.player_id === s.guests[0].player_id)!.bonus).toBe(0); // su racha se cortó en la ronda 2
    expect(r4.find((r) => r.player_id === s.host.player_id)!.bonus).toBe(150);
    const h = await player(s.host);
    expect(h).toMatchObject({ streak: 0, best_streak: 4, correct_count: 4, answered_count: 5 });
    const g = await player(s.guests[0]);
    expect(g).toMatchObject({ streak: 3, best_streak: 3, correct_count: 4, answered_count: 4 });
    // puntaje = suma de puntos + bonus
    const total = await row<{ sum: string }>(db.c, "select sum(points + bonus) from answers where player_id = $1", [s.host.player_id]);
    expect(await score(s.host)).toBe(Number(total.sum));
    expect((await row(db.c, "select status from rooms where id = $1", [s.host.room_id])).status).toBe("finished");
  });

  it("acumula el tiempo de respuesta para el promedio", async () => {
    const s = await setup(1, 2);
    await playRound(s, [1], [3]);
    await playRound(s, [0], [5]);
    expect(Number((await player(s.host)).total_ms)).toBe(8000); // bigint
  });
});

describe("round_results", () => {
  it("vacío antes de revelar (nadie ve elecciones ajenas); después trae elección, puntos y tiempo", async () => {
    const { host, guests, roundId } = await setup(2);
    await startedAgo(db.c, host.room_id, 4);
    const rid = await roundId();
    await answer(host, rid, 1);
    await answer(guests[0], rid, 3);
    expect(await rows(db.c, "select * from public.round_results($1)", [rid])).toHaveLength(0);
    await advance(host);
    const res = await rows(db.c, "select * from public.round_results($1) order by points desc", [rid]);
    expect(res).toEqual([
      expect.objectContaining({ player_id: host.player_id, choice: 1, is_correct: true, points: 900, time_ms: 4000, attempts: 1 }),
      expect.objectContaining({ player_id: guests[0].player_id, choice: 3, is_correct: false, points: 0 }),
    ]);
  });
});

describe("back_to_lobby (jugar otra vez)", () => {
  it("solo el anfitrión y solo con la partida terminada; reinicia y permite otra partida con puntajes en 0", async () => {
    const s = await setup(2, 1);
    await expect(rpc(db.c, "back_to_lobby", { p_token: s.host.token })).resolves.toBeDefined();
    expect((await row(db.c, "select status from rooms where id = $1", [s.host.room_id])).status).toBe("playing"); // aún no terminó
    await startedAgo(db.c, s.host.room_id);
    await answer(s.host, await s.roundId(), 1);
    await timeUp(db.c, s.host.room_id);
    await advance(s.host);
    await revealOver(db.c, s.host.room_id);
    await advance(s.host);
    await rpc(db.c, "back_to_lobby", { p_token: s.guests[0].token });
    expect((await row(db.c, "select status from rooms where id = $1", [s.host.room_id])).status).toBe("finished");
    await rpc(db.c, "back_to_lobby", { p_token: s.host.token });
    expect(await row(db.c, "select status, current_round, total_rounds from rooms where id = $1", [s.host.room_id])).toEqual({ status: "lobby", current_round: 0, total_rounds: 0 });
    expect(await rows(db.c, "select 1 from rounds where room_id = $1", [s.host.room_id])).toHaveLength(0);
    await rpc(db.c, "start_game", { p_token: s.host.token, p_rounds: [round(9)], p_source_type: "genre", p_source_label: "x" });
    expect(await score(s.host)).toBe(0);
    expect((await player(s.host)).best_streak).toBe(0);
  });
});
