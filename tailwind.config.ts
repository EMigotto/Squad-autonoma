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
        ink: {
          950: "#0a0a0a",
          900: "#141414",
          800: "#1f1f1f",
          700: "#2a2a2a",
          600: "#3a3a3a",
          400: "#737373",
          300: "#a3a3a3",
          100: "#fafafa",
        },
        // stage accents — each column gets one
        discovery: "#c084fc",
        planning: "#fbbf24",
        development: "#60a5fa",
        qa: "#4ade80",
        done: "#737373",
      },
    },
  },
  plugins: [],
};

export default config;
