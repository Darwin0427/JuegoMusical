import Link from "next/link";

// Logotipo: una sola tinta, con sombra dura de concurso
export default function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  const cls = size === "lg" ? "text-5xl sm:text-7xl [text-shadow:0_5px_0_var(--color-ink)]" : "text-2xl [text-shadow:0_3px_0_var(--color-ink)]";
  const text = <span className={`display text-paper ${cls}`}>JuegoMusical</span>;
  return size === "lg" ? <h1>{text}</h1> : <Link href="/" aria-label="Ir al inicio">{text}</Link>;
}
