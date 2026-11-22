import { describe, expect, it, vi } from "vitest";
vi.mock("@/components/RoomClient", () => ({ default: (p: { code: string }) => p }));
import SalaPage from "@/app/sala/[code]/page";

describe("página /sala/[code]", () => {
  it("pasa el código en mayúsculas al cliente de la sala", async () => {
    const el = await SalaPage({ params: Promise.resolve({ code: "ab12c" }) } as never);
    expect((el as { props: { code: string } }).props.code).toBe("AB12C");
  });
});
