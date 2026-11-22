import { describe, expect, it } from "vitest";
import { revealOver, round, row, rows, rpc, startedAgo, timeUp, setupDb, type Joined } from "./db";

const db = setupDb();

describe("_close_enough (tolerancia al escribir)", () => {
  it.each([
    ["borraxxo te esperare", "Borraxxo Te Esperaré", true],
    ["borracho te esperare", "Borraxxo Te Esperaré", true],
    ["BORRAXXO TE ESPERARÉ", "Borraxxo Te Esperaré", true],
    ["borraxo", "Borraxxo Te Esperaré", false],
    ["ppcp", "PPCP", true],
    ["titi me pregunto", "Tití Me Preguntó", true],
    ["despacito", "Despacito (Remix)", true],
    ["despasito", "Despacito - Remix", true],
    ["la bachata", "La Bachata (feat. Manuel Turizo)", true],
    ["la bachata", "La Bachata ft. Manuel Turizo", true],
    ["karol g", "Karol G & Nicki Minaj", true],
    ["nicki minaj", "Karol G & Nicki Minaj", true],
    ["karolg", "KAROL G", true],
    ["carol g", "KAROL G", true],
    ["bad buny", "Bad Bunny", true],
    ["peso pluma", "Bad Bunny, Peso Pluma", true],
    ["feid", "Feid y Karol G", true],
    ["mónaco", "MONACO", true],
    ["hola", "Ella Baila Sola", false],
    ["", "Feid", false],
    ["   ", "Feid", false],
    ["!!!", "Feid", false],
    ["a", "A", true],
    ["b", "A", false],
  ])("%s ≈ %s → %s", async (g, t, ok) => {
    expect((await row<{ r: boolean }>(db.c, "select public._close_enough($1, $2) as r", [g, t])).r).toBe(ok);
  });
});

async function typedGame(players = 2, target: "song" | "artist" = "song") {
  const host = await rpc<Joined>(db.c, "create_room", { p_nickname: "Darwin" });
  const all = [host];
  for (let i = 1; i < players; i++) all.push(await rpc<Joined>(db.c, "join_room", { p_code: host.code, p_nickname: `J${i}` }));
  await rpc(db.c, "start_game", {
    p_token: host.token,
    p_rounds: [{ ...round(1, -1), answer: { title: "Borraxxo Te Esperaré", artist: "Feid", cover: "c", link: "l" } }, round(2, -1)],
    p_source_type: "genre",
    p_source_label: "x",
    p_answer_mode: "typed",
    p_target: target,
  });
  await startedAgo(db.c, host.room_id, 3);
  const rid = (await row<{ id: string }>(db.c, "select id from rounds where room_id = $1 and round_number = 1", [host.room_id])).id;
  const say = (p: Joined, text: string) => rpc<{ correct: boolean; attempts_left: number }>(db.c, "submit_answer", { p_token: p.token, p_round_id: rid, p_text: text });
  return { host, all, rid, say };
}

describe("responder escribiendo", () => {
  it("las opciones no se publican (no se puede hacer trampa mirando la red)", async () => {
    const { host } = await typedGame();
    expect((await rows<{ options: unknown[] }>(db.c, "select options from rounds where room_id = $1", [host.room_id])).every((r) => r.options.length === 0)).toBe(true);
  });

  it("3 intentos: dice al instante si acertó y cuántos quedan; luego bloquea", async () => {
    const { all, say } = await typedGame();
    expect(await say(all[0], "te esperare")).toEqual({ ok: true, correct: false, attempts_left: 2 });
    expect(await say(all[0], "borracho te esperare")).toEqual({ ok: true, correct: true, attempts_left: 1 });
    await expect(say(all[0], "otra")).rejects.toThrow(/Ya respondiste/);
    expect(await say(all[1], "a")).toMatchObject({ attempts_left: 2 });
    expect(await say(all[1], "b")).toMatchObject({ attempts_left: 1 });
    expect(await say(all[1], "c")).toMatchObject({ correct: false, attempts_left: 0 });
    await expect(say(all[1], "Borraxxo Te Esperaré")).rejects.toThrow(/Ya respondiste/);
  });

  it("texto vacío o larguísimo se rechaza sin gastar intento", async () => {
    const { all, say } = await typedGame();
    await expect(say(all[0], "   ")).rejects.toThrow(/Escribe una respuesta/);
    await expect(say(all[0], "x".repeat(81))).rejects.toThrow(/Escribe una respuesta/);
    expect(await say(all[0], "nada")).toMatchObject({ attempts_left: 2 });
  });

  it("'listo' solo cuando acierta o gasta los 3; la ronda se cierra cuando todos terminan", async () => {
    const { host, all, say } = await typedGame();
    await say(all[0], "borraxxo te esperare");
    await say(all[1], "x");
    expect((await row(db.c, "select answered_round from players where id = $1", [all[1].player_id])).answered_round).toBe(0);
    expect(await rpc(db.c, "advance", { p_token: host.token })).toBe("waiting");
    await say(all[1], "y");
    await say(all[1], "z");
    expect((await row(db.c, "select answered_round from players where id = $1", [all[1].player_id])).answered_round).toBe(1);
    expect(await rpc(db.c, "advance", { p_token: host.token })).toBe("revealed");
  });

  it("los puntos cuentan desde el intento que acertó; el revelado muestra lo escrito y los intentos", async () => {
    const { host, all, rid, say } = await typedGame();
    await say(all[0], "mal");
    await startedAgo(db.c, host.room_id, 10);
    await say(all[0], "Borraxxo te esperare");
    await say(all[1], "monaco");
    await timeUp(db.c, host.room_id);
    await rpc(db.c, "advance", { p_token: host.token });
    const res = await rows(db.c, "select * from public.round_results($1) order by points desc", [rid]);
    expect(res[0]).toMatchObject({ player_id: all[0].player_id, is_correct: true, points: 750, attempts: 2, text_answer: "Borraxxo te esperare", time_ms: 10000 });
    expect(res[1]).toMatchObject({ is_correct: false, points: 0, attempts: 1, text_answer: "monaco" });
  });

  it("adivinando el artista compara contra el artista (vale cualquiera de una colaboración)", async () => {
    const { all, say } = await typedGame(2, "artist");
    expect((await say(all[0], "Borraxxo te esperare")).correct).toBe(false);
    expect((await say(all[0], "feid")).correct).toBe(true);
  });

  it("en modo opciones no se acepta texto", async () => {
    const host = await rpc<Joined>(db.c, "create_room", { p_nickname: "Darwin" });
    await rpc(db.c, "start_game", { p_token: host.token, p_rounds: [round(1)], p_source_type: "genre", p_source_label: "x" });
    await startedAgo(db.c, host.room_id);
    const rid = (await row<{ id: string }>(db.c, "select id from rounds where room_id = $1", [host.room_id])).id;
    await expect(rpc(db.c, "submit_answer", { p_token: host.token, p_round_id: rid, p_text: "Respuesta 1" })).rejects.toThrow(/Opción no válida/);
  });
});

describe("partida multijugador completa (4 jugadores, entradas y salidas)", () => {
  it("juega 4 rondas de punta a punta con alguien que entra a mitad y un anfitrión que se va", async () => {
    const host = await rpc<Joined>(db.c, "create_room", { p_nickname: "Darwin", p_is_public: true });
    const ana = await rpc<Joined>(db.c, "join_room", { p_code: host.code, p_nickname: "Ana" });
    const sebas = await rpc<Joined>(db.c, "join_room", { p_code: host.code, p_nickname: "Sebas" });
    expect((await rows(db.c, "select * from public.list_public_rooms()")).map((r) => r.code)).toContain(host.code);

    await rpc(db.c, "start_game", {
      p_token: host.token,
      p_rounds: [round(1, 0), round(2, 1), round(3, 2), round(4, 3)],
      p_source_type: "playlist",
      p_source_label: "Reguetón",
      p_round_seconds: 10,
    });
    expect((await rows(db.c, "select * from public.list_public_rooms()")).map((r) => r.code)).not.toContain(host.code); // ya no está en espera

    const rid = async () => (await row<{ id: string }>(db.c, "select r.id from rounds r join rooms m on m.id = r.room_id and r.round_number = m.current_round where m.id = $1", [host.room_id])).id;
    const go = async (p: Joined, choice: number, ago: number) => {
      await startedAgo(db.c, host.room_id, ago);
      return rpc(db.c, "submit_answer", { p_token: p.token, p_round_id: await rid(), p_choice: choice });
    };
    const nextRound = async (by: Joined) => {
      await timeUp(db.c, host.room_id);
      expect(await rpc(db.c, "advance", { p_token: by.token })).toBe("revealed");
      await revealOver(db.c, host.room_id);
      return rpc(db.c, "advance", { p_token: by.token });
    };

    // Ronda 1: todos responden → se cierra sola
    await go(host, 0, 1);
    await go(ana, 0, 2);
    await go(sebas, 3, 2);
    expect(await rpc(db.c, "advance", { p_token: sebas.token })).toBe("revealed");
    await revealOver(db.c, host.room_id);
    expect(await rpc(db.c, "advance", { p_token: ana.token })).toBe("next");

    // Ronda 2: entra Vale a mitad de partida y juega
    const vale = await rpc<Joined>(db.c, "join_room", { p_code: host.code, p_nickname: "Vale" });
    await go(vale, 1, 1);
    await go(host, 1, 5);
    expect(await nextRound(vale)).toBe("next");

    // Ronda 3: el anfitrión se va; Ana hereda la sala y la partida sigue sin él
    await rpc(db.c, "leave_room", { p_token: host.token });
    expect((await row(db.c, "select host_player_id from rooms where id = $1", [host.room_id])).host_player_id).toBe(ana.player_id);
    await go(ana, 2, 2);
    await go(sebas, 2, 3);
    await go(vale, 0, 1);
    expect(await rpc(db.c, "advance", { p_token: vale.token })).toBe("revealed"); // los 3 que quedan respondieron

    await revealOver(db.c, host.room_id);
    expect(await rpc(db.c, "advance", { p_token: sebas.token })).toBe("next");

    // Ronda 4: nadie responde; se acaba el tiempo
    expect(await nextRound(ana)).toBe("finished");

    const final = await rows<{ nickname: string; score: number; correct_count: number; answered_count: number }>(
      db.c,
      "select nickname, score, correct_count, answered_count from players where room_id = $1 order by score desc",
      [host.room_id],
    );
    // Vale (950, acertó en 1 s) supera a Sebas (850, acertó en 3 s)
    expect(final.map((p) => p.nickname)).toEqual(["Ana", "Vale", "Sebas"]);
    expect(final[0]).toMatchObject({ correct_count: 2, answered_count: 2 }); // R1 y R3
    expect(final[1]).toMatchObject({ score: 950, correct_count: 1, answered_count: 2 }); // R2
    expect(final[2]).toMatchObject({ score: 850, correct_count: 1, answered_count: 2 }); // R3
    expect(final[0].score).toBe(900 + 900); // 2 s de 10 → 500 + 400, dos veces
    expect(await rows(db.c, "select 1 from players where id = $1", [host.player_id])).toHaveLength(0);

    // Jugar otra vez con el nuevo anfitrión
    await rpc(db.c, "back_to_lobby", { p_token: ana.token });
    expect((await row(db.c, "select status from rooms where id = $1", [host.room_id])).status).toBe("lobby");
  });

  it("dos salas jugando a la vez no se mezclan", async () => {
    const a = await rpc<Joined>(db.c, "create_room", { p_nickname: "A" });
    const b = await rpc<Joined>(db.c, "create_room", { p_nickname: "B" });
    for (const h of [a, b]) await rpc(db.c, "start_game", { p_token: h.token, p_rounds: [round(1, 1)], p_source_type: "genre", p_source_label: "x" });
    await startedAgo(db.c, a.room_id);
    await startedAgo(db.c, b.room_id);
    const ra = (await row<{ id: string }>(db.c, "select id from rounds where room_id = $1", [a.room_id])).id;
    await rpc(db.c, "submit_answer", { p_token: a.token, p_round_id: ra, p_choice: 1 });
    expect(await rpc(db.c, "advance", { p_token: a.token })).toBe("revealed");
    expect(await rpc(db.c, "advance", { p_token: b.token })).toBe("waiting");
    await expect(rpc(db.c, "submit_answer", { p_token: b.token, p_round_id: ra, p_choice: 1 })).rejects.toThrow(/Ronda no válida/);
  });
});
