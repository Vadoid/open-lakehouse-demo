import { defineConfig } from "vitest/config";

// Node environment by default — the lib functions under test are pure. The two
// files that touch window/localStorage (demoConfig load/save) opt into jsdom
// per-file with a `// @vitest-environment jsdom` pragma at the top of the test.
//
// Coverage is scoped to the files we actually test, not the whole app. The app
// is mostly I/O-bound glue (Thrift, Lakekeeper, S3/GCS, API routes, React) that
// is integration territory and deliberately out of scope here — pointing
// coverage at it would report a misleadingly low number for code we chose not
// to unit test. The line threshold is lenient (70%) because a few exports in
// the scoped files stay untested on purpose; there is no function-coverage gate.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "lib/demoConfig.ts",
        "lib/sqlHighlight.ts",
        "lib/cache.ts",
        "lib/steps.ts",
      ],
      thresholds: {
        lines: 70,
      },
    },
  },
});
