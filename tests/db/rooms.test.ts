import { describe, expect, it } from "vitest";
import { asAnon, rpc, row, rows, setupDb, type Joined } from "./db";

const db = setupDb();
const create = (nick = "Darwin", pub = false) => rpc<Joined>(db.c, "create_room", { p_nickname: nick, p_is_public: pub });
const join = (code: string, nick: string) => rpc<Joined>(db.c, "join_room", { p_code: code, p_nickname: nick });

describe("create_room", () => {
  it("crea la sala en lobby con código de 5 caracteres sin letras confusas (0, O, 1, I)", async () => {
    const r = await create();
    expect(r.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ2-9]{5}$/);
    const room = await row(db.c, "select * from rooms where id = $1", [r.room_id]);
    expect(room).toMatchObject({ status: "lobby", host_player_id: r.player_id, is_public: false, current_round: 0 });
  });

  it("los códigos no se repiten (200 salas)", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) codes.add((await create(`P${i}`)).code);
    expect(codes.size).toBe(200);
  });

  it("el token secreto es distinto para cada jugador y no es el id", async () => {
    const r = await create();
    expect(r.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.token).not.toBe(r.player_id);
  });

  it("recorta el apodo y valida su largo (1 a 20)", async () => {
    const r = await create("   Darwin   ");
    expect((await row(db.c, "select nickname from players where id = $1", [r.player_id])).nickname).toBe("Darwin");
    await expect(create("   ")).rejects.toThrow(/entre 1 y 20/);
    await expect(create("x".repeat(21))).rejects.toThrow(/entre 1 y 20/);
    await expect(rpc(db.c, "create_room", { p_nickname: null })).rejects.toThrow(/entre 1 y 20/);
  });
});

describe("join_room", () => {
  it("se une con el código sin importar mayúsculas ni espacios", async () => {
    const h = await create();
    const g = await join(`  ${h.code.toLowerCase()} `, "Ana");
    expect(g.room_id).toBe(h.room_id);
    expect(await rows(db.c, "select nickname from players where room_id = $1 order by joined_at", [h.room_id])).toHaveLength(2);
  });

  it("código inexistente", async () => {
    await expect(join("ZZZZZ", "Ana")).rejects.toThrow(/No existe una sala con ese código/);
  });

  it("no permite apodos repetidos en la misma sala (sin importar mayúsculas)", async () => {
    const h = await create("Darwin");
    await expect(join(h.code, "darwin")).rejects.toThrow(/Ya hay alguien con ese apodo/);
    const otra = await create("Ana");
    await expect(join(otra.code, "Darwin")).resolves.toBeTruthy(); // en otra sala sí
  });

  it("máximo 12 jugadores", async () => {
    const h = await create("J0");
    for (let i = 1; i < 12; i++) await join(h.code, `J${i}`);
    await expect(join(h.code, "J12")).rejects.toThrow(/llena/);
  });

  it("se puede entrar a una partida en curso, pero no a una terminada hace más de 2 horas", async () => {
    const h = await create();
    await db.c.query("update rooms set status = 'playing' where id = $1", [h.room_id]);
    await expect(join(h.code, "Ana")).resolves.toBeTruthy();
    await db.c.query("update rooms set status = 'finished', updated_at = now() - interval '3 hours' where id = $1", [h.room_id]);
    await expect(join(h.code, "Sebas")).rejects.toThrow(/ya terminó/);
  });
});

describe("leave_room", () => {
  it("si sale el anfitrión, el siguiente en llegar pasa a ser anfitrión", async () => {
    const h = await create("Darwin");
    const a = await join(h.code, "Ana");
    await join(h.code, "Sebas");
    await rpc(db.c, "leave_room", { p_token: h.token });
    expect((await row(db.c, "select host_player_id from rooms where id = $1", [h.room_id])).host_player_id).toBe(a.player_id);
  });

  it("si sale un invitado el anfitrión no cambia", async () => {
    const h = await create();
    const a = await join(h.code, "Ana");
    await rpc(db.c, "leave_room", { p_token: a.token });
    expect((await row(db.c, "select host_player_id from rooms where id = $1", [h.room_id])).host_player_id).toBe(h.player_id);
  });

  it("si sale el último, la sala se borra completa (jugadores, rondas, secretos)", async () => {
    const h = await create();
    await rpc(db.c, "leave_room", { p_token: h.token });
    expect(await rows(db.c, "select 1 from rooms where id = $1", [h.room_id])).toHaveLength(0);
    expect(await rows(db.c, "select 1 from player_secrets where player_id = $1", [h.player_id])).toHaveLength(0);
  });

  it("con un token inválido no hace nada", async () => {
    const h = await create();
    await rpc(db.c, "leave_room", { p_token: "00000000-0000-0000-0000-000000000000" });
    expect(await rows(db.c, "select 1 from players where room_id = $1", [h.room_id])).toHaveLength(1);
  });
});

describe("list_public_rooms", () => {
  it("solo salas públicas, en lobby y con actividad en las últimas 2 horas, con anfitrión y número de jugadores", async () => {
    const pub = await create("Darwin", true);
    await join(pub.code, "Ana");
    await create("Privado", false);
    const jugando = await create("Jugando", true);
    await db.c.query("update rooms set status = 'playing' where id = $1", [jugando.room_id]);
    const vieja = await create("Viejo", true);
    await db.c.query("update rooms set updated_at = now() - interval '3 hours' where id = $1", [vieja.room_id]);
    const list = await rows<{ code: string; host: string; players: string }>(db.c, "select * from public.list_public_rooms()");
    expect(list.map((r) => r.code)).toEqual([pub.code]);
    expect(list[0]).toMatchObject({ host: "Darwin", players: "2" });
  });
});

describe("permisos (lo que puede hacer el navegador directamente)", () => {
  it("puede LEER salas, jugadores y rondas (para el tiempo real)", async () => {
    await create();
    for (const t of ["rooms", "players", "rounds"]) await expect(asAnon(db.c, `select * from ${t}`)).resolves.toBeTruthy();
  });

  it.each(["player_secrets", "round_secrets", "answers"])("NO puede leer %s (tokens, respuestas correctas y elecciones)", async (t) => {
    await expect(asAnon(db.c, `select * from ${t}`)).rejects.toThrow(/permission denied/);
  });

  it.each([
    ["insertar salas", "insert into rooms(code) values ('HACK1')"],
    ["subirse el puntaje", "update players set score = 99999"],
    ["volverse anfitrión", "update rooms set host_player_id = null"],
    ["borrar salas", "delete from rooms"],
    ["cambiar la respuesta revelada", "update rounds set correct_index = 0"],
  ])("NO puede %s", async (_d, sql) => {
    await create();
    await expect(asAnon(db.c, sql)).rejects.toThrow(/permission denied/);
  });

  it.each(["_player_from_token(gen_random_uuid())", "_new_code()", "_norm('x')", "_close_enough('a','b')", "_streak_bonus(3)"])(
    "NO puede llamar funciones internas: %s",
    async (fn) => {
      await expect(asAnon(db.c, `select public.${fn}`)).rejects.toThrow(/permission denied/);
    },
  );

  it("las tablas tienen RLS activado y Realtime publica rooms, players y rounds", async () => {
    const rls = await rows<{ relname: string; relrowsecurity: boolean }>(
      db.c,
      "select relname, relrowsecurity from pg_class where relname in ('rooms','players','rounds','player_secrets','round_secrets','answers')",
    );
    expect(rls.every((r) => r.relrowsecurity)).toBe(true);
    const pub = await rows<{ tablename: string }>(db.c, "select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1");
    expect(pub.map((p) => p.tablename)).toEqual(["players", "rooms", "rounds"]);
  });

  it("server_now responde la hora del servidor", async () => {
    const r = await rpc<Date>(db.c, "server_now");
    expect(Math.abs(new Date(r).getTime() - Date.now())).toBeLessThan(60_000);
  });
});
