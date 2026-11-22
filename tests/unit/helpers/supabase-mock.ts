import { vi } from "vitest";
import type { Player, Room, Round } from "@/lib/supabase";

// Simulación del cliente de Supabase: tablas en memoria, rpc y canales en tiempo real
export function createSupabaseMock() {
  const tables: Record<string, Record<string, unknown>[]> = { rooms: [], players: [], rounds: [] };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const rpc = vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({ data: null as unknown, error: null as null | { message: string } }));
  const channelHandlers: (() => void)[] = [];

  function query(table: string) {
    const filters: [string, unknown, "eq" | "notnull"][] = [];
    let orderBy: string | null = null;
    const run = () => {
      let rows = [...(tables[table] ?? [])];
      for (const [col, val, op] of filters) rows = rows.filter((r) => (op === "eq" ? r[col] === val : r[col] !== null && r[col] !== undefined));
      if (orderBy) rows.sort((a, b) => String(a[orderBy!]).localeCompare(String(b[orderBy!]), undefined, { numeric: true }));
      return rows;
    };
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => (filters.push([c, v, "eq"]), b),
      not: (c: string) => (filters.push([c, null, "notnull"]), b),
      order: (c: string) => ((orderBy = c), b),
      maybeSingle: async () => ({ data: run()[0] ?? null, error: null }),
      then: (res: (v: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: run(), error: null }).then(res),
    };
    return b;
  }

  const channel = {
    on: (_e: string, _f: unknown, cb: () => void) => (channelHandlers.push(cb), channel),
    subscribe: () => channel,
  };

  const supabase = { rpc, from: vi.fn(query), channel: vi.fn(() => channel), removeChannel: vi.fn() };
  return {
    supabase,
    rpc,
    tables,
    /** Simula un aviso de Realtime */
    emitChange: () => channelHandlers.forEach((h) => h()),
  };
}

export const makeRoom = (o: Partial<Room> = {}): Room => ({
  id: "room1", code: "ABCDE", host_player_id: "p1", status: "lobby", is_public: false, source_type: "genre", source_label: "Rap",
  total_rounds: 3, current_round: 0, round_seconds: 20, answer_mode: "choice", target: "song", ...o,
});

export const makePlayer = (o: Partial<Player> = {}): Player => ({
  id: "p1", room_id: "room1", nickname: "Darwin", score: 0, answered_round: 0, joined_at: "2026-01-01T00:00:01Z",
  streak: 0, best_streak: 0, correct_count: 0, answered_count: 0, total_ms: 0, ...o,
});

export const makeRound = (now: number, o: Partial<Round> = {}): Round => ({
  id: "r1", room_id: "room1", round_number: 1, preview_url: "https://cdn/1.mp3", start_offset: 0,
  options: [
    { title: "Tusa", artist: "Karol G", cover: "c1" },
    { title: "Provenza", artist: "Karol G", cover: "c2" },
    { title: "Bichota", artist: "Karol G", cover: "c3" },
    { title: "Mamiii", artist: "Becky G", cover: "c4" },
  ],
  starts_at: new Date(now - 2000).toISOString(), ends_at: new Date(now + 18000).toISOString(),
  revealed_at: null, correct_index: null, answer: null, ...o,
});

export const session = { room_id: "room1", code: "ABCDE", player_id: "p1", token: "tok-1" };
