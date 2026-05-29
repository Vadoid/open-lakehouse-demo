"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return (document.documentElement.dataset.theme as Theme) || "dark";
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setTheme(currentTheme());
  }, []);

  function flip() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* private mode etc. */ }
    setTheme(next);
  }

  // Render an invisible placeholder pre-mount so layout doesn't shift.
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";

  return (
    <button
      type="button"
      onClick={flip}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center w-8 h-8 rounded border border-ink-700 bg-ink-900/40 hover:border-ice-500/60 hover:text-ice-200 text-gray-300 transition"
    >
      {!mounted ? (
        <span className="block w-4 h-4" />
      ) : theme === "dark" ? (
        // Sun icon — currently dark, click to go light
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        // Moon icon — currently light, click to go dark
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
