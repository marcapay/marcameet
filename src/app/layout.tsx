import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marca Meet - Plataforma de Inteligência de Reuniões",
  description: "Gravação, transcrição, análise por inteligência artificial, decisões, tarefas e memória pesquisável de reuniões.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark overflow-x-hidden">
      <body className="antialiased bg-slate-950 text-slate-100 min-h-screen max-w-full overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
