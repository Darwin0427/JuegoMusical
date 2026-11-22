export { makePlayer, makeRound, session } from "./supabase-mock";
import { makeRoom } from "./supabase-mock";
import type { Room } from "@/lib/supabase";
export const makRoomPatch = (o: Partial<Room> = {}) => makeRoom({ status: "playing", current_round: 1, ...o });
