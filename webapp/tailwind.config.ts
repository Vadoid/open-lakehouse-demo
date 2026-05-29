import type { Config } from "tailwindcss";

// Palette routed through CSS variables so the whole UI flips by toggling
// `data-theme` on <html>. Each var holds a bare `R G B` triplet; the
// `<alpha-value>` placeholder lets opacity utilities (e.g. `bg-ink-900/40`)
// keep working without per-component edits.
const rgbVar = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        ice: {
          50:  rgbVar("--ice-50"),
          100: rgbVar("--ice-100"),
          200: rgbVar("--ice-200"),
          300: rgbVar("--ice-300"),
          400: rgbVar("--ice-400"),
          500: rgbVar("--ice-500"),
          700: rgbVar("--ice-700"),
        },
        ink: {
          700: rgbVar("--ink-700"),
          800: rgbVar("--ink-800"),
          900: rgbVar("--ink-900"),
        },
        gray: {
          100: rgbVar("--gray-100"),
          200: rgbVar("--gray-200"),
          300: rgbVar("--gray-300"),
          400: rgbVar("--gray-400"),
          500: rgbVar("--gray-500"),
          600: rgbVar("--gray-600"),
          700: rgbVar("--gray-700"),
        },
      },
      fontFamily: { mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
    },
  },
  plugins: [],
};
export default config;
