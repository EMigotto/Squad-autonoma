"use client";

import Link from "next/link";

export default function AssistantFAB() {
  return (
    <Link
      href="/assistant"
      title="abrir Squad Assistant"
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 bg-discovery text-ink-950 px-4 py-3 font-bold text-sm shadow-[0_0_24px_rgba(255,255,255,0.08)] hover:bg-discovery/80 transition-colors"
      style={{ boxShadow: "0 0 0 2px rgba(0,0,0,0.6), 0 8px 24px rgba(0,0,0,0.5)" }}
    >
      <span className="text-lg leading-none">◈</span>
      <span className="uppercase tracking-widest text-xs">assistente</span>
      <span className="ml-1 inline-block w-1.5 h-1.5 bg-ink-950 rounded-full animate-pulse" />
    </Link>
  );
}
