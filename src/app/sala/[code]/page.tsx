import RoomClient from "@/components/RoomClient";

export default async function SalaPage({ params }: PageProps<"/sala/[code]">) {
  const { code } = await params;
  return <RoomClient code={code.toUpperCase()} />;
}
