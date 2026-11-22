import { buildRounds, getTracks, type SourceType } from "@/lib/deezer";
import { supabase } from "@/lib/supabase";

// El servidor arma las rondas y las guarda directamente en Supabase,
// así las respuestas correctas nunca pasan por el navegador de nadie.
export async function POST(req: Request) {
  let body: {
    token?: string; source_type?: SourceType; source_id?: string; source_label?: string; rounds?: number; seconds?: number;
    target?: string; answer_mode?: string;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Solicitud no válida" }, { status: 400 });
  }
  const { token, source_type, source_id, source_label } = body;
  if (!token || !source_id || !["genre", "playlist", "artist"].includes(source_type ?? "")) {
    return Response.json({ error: "Faltan datos para iniciar" }, { status: 400 });
  }
  const count = Math.max(3, Math.min(Number(body.rounds) || 10, 20));
  const seconds = Math.max(10, Math.min(Number(body.seconds) || 20, 30));
  const target = body.target === "artist" ? "artist" : "song";
  const answerMode = body.answer_mode === "typed" ? "typed" : "choice";
  if (target === "artist" && source_type === "artist") {
    return Response.json({ error: "Con un solo artista no tiene sentido adivinar el artista. Elige adivinar la canción." }, { status: 400 });
  }

  try {
    const tracks = await getTracks(source_type as SourceType, source_id);
    const rounds = buildRounds(tracks, { count, target, answerMode });
    const { error } = await supabase.rpc("start_game", {
      p_token: token,
      p_rounds: rounds,
      p_source_type: source_type,
      p_source_label: (source_label ?? "").slice(0, 80),
      p_round_seconds: seconds,
      p_answer_mode: answerMode,
      p_target: target,
    });
    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ ok: true, rounds: rounds.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
