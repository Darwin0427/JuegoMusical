import { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, inject } from "vitest";

// Cada prueba corre dentro de una transacción que se deshace al final: la base queda limpia.
// Las llamadas del "jugador" se hacen con el rol anon, igual que desde el navegador.
export function setupDb() {
  const ctx = { c: null as unknown as Client };
  beforeAll(async () => {
    ctx.c = new Client({ connectionString: inject("dbUrl") });
    await ctx.c.connect();
  });
  afterAll(async () => ctx.c.end());
  beforeEach(async () => ctx.c.query("begin"));
  afterEach(async () => ctx.c.query("rollback"));
  return ctx;
}

let sp = 0;

/** Llama una función RPC como el navegador (rol anon). Lanza si la base responde con error. */
export async function rpc<T = unknown>(c: Client, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const keys = Object.keys(args);
  const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
  const name = `s${++sp}`;
  await c.query(`savepoint ${name}`);
  await c.query("set local role anon");
  try {
    const res = await c.query(sql, keys.map((k) => (args[k] !== null && typeof args[k] === "object" ? JSON.stringify(args[k]) : args[k])));
    await c.query("reset role");
    await c.query(`release savepoint ${name}`);
    return res.rows[0].r as T;
  } catch (e) {
    await c.query(`rollback to savepoint ${name}`);
    await c.query("reset role");
    throw e;
  }
}

/** Ejecuta SQL como anon (para probar permisos). */
export async function asAnon(c: Client, sql: string, params: unknown[] = []) {
  const name = `s${++sp}`;
  await c.query(`savepoint ${name}`);
  await c.query("set local role anon");
  try {
    const r = await c.query(sql, params);
    await c.query("reset role");
    await c.query(`release savepoint ${name}`);
    return r;
  } catch (e) {
    await c.query(`rollback to savepoint ${name}`);
    await c.query("reset role");
    throw e;
  }
}

export type Joined = { room_id: string; code: string; player_id: string; token: string };

export const opts = (titles = ["A", "B", "C", "D"]) => titles.map((t) => ({ title: t, artist: `Art ${t}`, cover: "c" }));

/** Ronda de prueba: la correcta es `correct` (0-3) y su respuesta es "Respuesta N" */
export const round = (n: number, correct = 1, extra: Record<string, unknown> = {}) => ({
  preview_url: `https://cdn/${n}.mp3`,
  options: opts(),
  correct_index: correct,
  start_offset: 0,
  answer: { title: `Respuesta ${n}`, artist: "Karol G & Nicki Minaj", cover: "c", link: `https://deezer.com/track/${n}` },
  ...extra,
});

/** Mueve el reloj de la ronda actual: empezó hace `ago` segundos (superusuario, como si pasara el tiempo) */
export async function startedAgo(c: Client, roomId: string, ago = 3) {
  await c.query(
    `update rounds r set starts_at = now() - make_interval(secs => $2), ends_at = now() - make_interval(secs => $2) + make_interval(secs => rm.round_seconds)
       from rooms rm where rm.id = $1 and r.room_id = rm.id and r.round_number = rm.current_round`,
    [roomId, ago],
  );
}

/** Da la ronda actual por terminada (se acabó el tiempo) */
export async function timeUp(c: Client, roomId: string) {
  await c.query(`update rounds r set ends_at = now() - interval '1 second' from rooms rm where rm.id = $1 and r.room_id = rm.id and r.round_number = rm.current_round`, [roomId]);
}

/** Simula que pasaron los 5 s de la revelación */
export async function revealOver(c: Client, roomId: string) {
  await c.query(`update rounds r set revealed_at = now() - interval '6 seconds' from rooms rm where rm.id = $1 and r.room_id = rm.id and r.round_number = rm.current_round`, [roomId]);
}

export const row = async <T = Record<string, unknown>>(c: Client, sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0] as T;
export const rows = async <T = Record<string, unknown>>(c: Client, sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows as T[];
