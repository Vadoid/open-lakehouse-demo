import "./globals.css";
import type { Metadata } from "next";
import HeaderActions from "@/components/HeaderActions";
import StepRail from "@/components/StepRail";
import SetupGuard from "@/components/SetupGuard";

export const metadata: Metadata = {
  title: "Open Lakehouse with Iceberg V3",
  description: "Open lakehouse tech demo: Apache Iceberg V3 on Lakekeeper, Spark Thrift, and MinIO",
};

// Runs before paint to avoid a flash of the wrong theme. Reads
// `localStorage.theme` first, then `prefers-color-scheme`, defaulting to dark.
const themeBootScript = `try{
  var t = localStorage.getItem('theme');
  if (t !== 'light' && t !== 'dark') {
    t = (matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = t;
}catch(e){ document.documentElement.dataset.theme = 'dark'; }`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="min-h-screen flex flex-col">
        <SetupGuard>
          <header className="border-b border-ink-700 bg-ink-900/80 backdrop-blur">
            <div className="px-6 py-3 flex items-center justify-between">
              <a
                href="/"
                className="flex items-center gap-2 group"
                aria-label="Open Lakehouse with Iceberg V3, home"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/iceberg.png"
                  alt=""
                  aria-hidden="true"
                  width={544}
                  height={564}
                  className="h-9 w-auto object-contain transition-transform group-hover:scale-110"
                />
                <span className="text-lg font-semibold text-ice-100 group-hover:text-ice-300 tracking-tight">
                  Open Lakehouse with Iceberg V3
                </span>
              </a>
              <HeaderActions />
            </div>
          </header>
          <div className="flex-1 flex">
            <StepRail />
            <main className="flex-1 overflow-auto">{children}</main>
          </div>
        </SetupGuard>
      </body>
    </html>
  );
}
