import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";


export const metadata: Metadata = {
  title: "JuegoMusical · Adivina la canción con tus amigos",
  description: "Crea una sala, comparte el código y compite adivinando canciones en tiempo real.",
};

export const viewport: Viewport = { themeColor: "#0b0814" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
