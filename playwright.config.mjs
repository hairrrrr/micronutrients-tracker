// Playwright configuration (PLAN.md phase P13).
//
// Uses the system Chrome (`channel: "chrome"`) instead of the Playwright
// browser bundles: no `playwright install` is needed, and the tests run in the
// same browser the site's users have. Headless by default.
//
// Two static servers are started for a plain local run:
//   - http://localhost:8123/        serves docs/            (the normal entry)
//   - http://localhost:8125/        serves the repo root    (sub-path check)
// When BASE_URL is set (e.g. the deployed GitHub Pages URL) no server is
// started and every test uses that base URL; the sub-path test is skipped
// because it needs a parent directory above the site.

import { defineConfig, devices } from "@playwright/test";

/** Deployed or externally served base URL; empty for a local run. */
const BASE_URL = process.env.BASE_URL || "";

/** Local entry point: docs/ as the web root. */
const LOCAL_BASE = "http://localhost:8123/";

/** Local sub-path check: the repo root, so the site is at /docs/. */
export const SUBPATH_BASE = "http://localhost:8125/docs/";

/** Port of the docs/ server and of the repo-root server. */
const DOCS_PORT = 8123;
const ROOT_PORT = 8125;

/** Servers only for a local run (BASE_URL means someone else serves the site). */
const webServer = BASE_URL
  ? undefined
  : [
      {
        command: `python3 -m http.server ${DOCS_PORT} -d docs`,
        url: LOCAL_BASE,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        // The static server logs one line per request; keep the test output
        // readable (a failure still shows the page's console errors).
        stdout: "ignore",
        stderr: "ignore",
      },
      {
        command: `python3 -m http.server ${ROOT_PORT} -d .`,
        url: `http://localhost:${ROOT_PORT}/docs/`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        stdout: "ignore",
        stderr: "ignore",
      },
    ];

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  // Screenshots are written by screens.spec.mjs: one worker keeps the state of
  // each file predictable and the two static servers are cheap.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL || LOCAL_BASE,
    channel: "chrome",
    headless: true,
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
    // A failing test leaves a trace, but no screenshot: the images of the
    // screens spec are the only pictures of this project.
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 390, height: 844 } },
    },
  ],
  webServer,
});
