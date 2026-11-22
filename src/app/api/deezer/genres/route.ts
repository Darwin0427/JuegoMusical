import { getGenres } from "@/lib/deezer";

export async function GET() {
  try {
    return Response.json({ data: await getGenres() });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
