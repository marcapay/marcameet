import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Marca Meet - Plataforma de Inteligência de Reuniões",
  description: "Gravação, transcrição, análise por inteligência artificial, decisões, tarefas e memória pesquisável de reuniões.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="antialiased bg-slate-950 text-slate-100 min-h-screen">
        {children}
      </body>
    </html>
  );
}
