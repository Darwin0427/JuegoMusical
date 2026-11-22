import type { NextRequest } from "next/server";
import { search } from "@/lib/deezer";

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type");
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80);
  if ((type !== "artist" && type !== "playlist") || !q) {
    return Response.json({ error: "Parámetros no válidos" }, { status: 400 });
  }
  try {
    return Response.json({ data: await search(type, q) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
