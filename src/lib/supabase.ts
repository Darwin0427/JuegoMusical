import { createClient } from "@supabase/supabase-js";

// Proyecto "juego-musical" (separado de cualquier otro proyecto).
// La clave publicable es pública por diseño: la seguridad está en RLS y en las funciones RPC.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://cbkamjyopkpjrnkhsutx.supabase.co";
export const SUPABASE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_BiRWez1qkEHLJpgI6b2afQ_HUyUmGa1";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

export type Room = {
  id: string;
  code: string;
  host_player_id: string | null;
  status: "lobby" | "playing" | "finished";
  is_public: boolean;
  source_type: "genre" | "playlist" | "artist" | null;
  source_label: string | null;
  total_rounds: number;
  current_round: number;
  round_seconds: number;
};

export type Player = {
  id: string;
  room_id: string;
  nickname: string;
  score: number;
  answered_round: number;
  joined_at: string;
};

export type Option = { title: string; artist: string };

export type Round = {
  id: string;
  room_id: string;
  round_number: number;
  preview_url: string;
  options: Option[];
  starts_at: string | null;
  ends_at: string | null;
  revealed_at: string | null;
  correct_index: number | null;
  answer: { title: string; artist: string; cover: string; link: string } | null;
};

export type RoundResult = { player_id: string; choice: number; is_correct: boolean; points: number };
