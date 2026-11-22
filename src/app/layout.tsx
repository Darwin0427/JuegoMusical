import type { Metadata, Viewport } from "next";
import "@fontsource/lilita-one/latin-400.css";
import "@fontsource-variable/nunito/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "JuegoMusical · Adivina la canción con tus amigos",
  description: "Crea una sala, comparte el código y compite adivinando canciones en tiempo real.",
};

export const viewport: Viewport = { themeColor: "#2340e0" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="antialiased">
      <body className="font-sans">{children}</body>
    </html>
  );
}
