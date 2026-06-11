import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "{V.AI.be} Cielo",
  description: "Pair-programming com agentes Claude orquestrado por Kanban",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-ink-950 text-ink-100 antialiased">{children}</body>
    </html>
  );
}
