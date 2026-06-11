import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-mono)", "ui-monospace", "monospace"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        // Tema CLARO (Cielo). A escala é invertida em relação ao tema dark
        // anterior: 950 = fundo branco ... 100 = texto navy. Assim as classes
        // existentes (bg-ink-950, text-ink-100, border-ink-800, ...) passam a
        // render­izar claro sem precisar editar componente por componente.
        ink: {
          950: "#ffffff", // fundo da página
          900: "#f3f6f9", // superfícies / cards
          800: "#e4eaef", // bordas sutis / hover
          700: "#cfd8e0", // bordas / inputs
          600: "#aeb9c4", // borda forte / divisores
          500: "#8a97a3", // texto bem suave
          400: "#67757f", // texto suave (legível no branco)
          300: "#4a5862", // texto secundário
          200: "#27343d", // texto secundário forte
          100: "#0a2733", // texto principal (navy Cielo)
        },
        // acentos por etapa — ajustados pra contraste em fundo claro
        discovery: "#7c3aed",   // roxo
        planning: "#b8730b",    // âmbar
        development: "#0086b8", // azul Cielo
        qa: "#1a8a4a",          // verde
        done: "#64748b",        // slate
      },
    },
  },
  plugins: [],
};

export default config;
