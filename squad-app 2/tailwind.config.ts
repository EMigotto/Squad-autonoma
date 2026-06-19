import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-body)", "Inter", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        disp: ["var(--font-disp)", "Space Grotesk", "sans-serif"],
      },
      colors: {
        // Tema ESCURO teal (padrão do business case Cielo).
        // 950 = fundo ... 100 = texto claro. Classes existentes
        // (bg-ink-950, text-ink-100, ...) renderizam escuro sem editar
        // componente por componente.
        ink: {
          950: "#0B1518", // fundo da página
          900: "#102228", // superfícies / cards (surface-2)
          800: "#13262C", // superfícies elevadas (surface)
          700: "#1E363D", // bordas sutis
          600: "#2C474F", // bordas fortes / divisores
          500: "#5F7B80", // texto bem suave (faint)
          400: "#8FAAAF", // texto suave (muted)
          300: "#B7CBCE", // texto secundário
          200: "#D5E2E2", // texto secundário forte
          100: "#EAF2F0", // texto principal
        },
        // acentos por etapa — paleta do business case
        discovery: "#A78BFA",   // violeta claro
        planning: "#E3A33D",    // âmbar
        development: "#52B9DC", // azul copilot
        qa: "#37C97C",          // verde eco
        done: "#7d8f96",        // slate teal
      },
      borderRadius: {
        card: "13px",
        panel: "18px",
      },
    },
  },
  plugins: [],
};

export default config;
