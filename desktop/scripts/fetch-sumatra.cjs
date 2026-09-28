#!/usr/bin/env node
// Downloads the portable SumatraPDF build used for silent kitchen printing.
//
// Why bundled instead of "installed on the machine": the terminals in the
// restaurants run unattended Windows 7 machines that nobody maintains, so the
// PDF engine has to ship inside the installer rather than depend on a manual
// setup step on every till.
//
// The 32-bit build is deliberate: the desktop shell is pinned to Electron 22 /
// ia32 for Windows 7, and this is the last architecture Sumatra still ships.
// 3.6.1 is the current release and its manual states Windows 7-11 support.
//
// Idempotent: does nothing when the executable is already present. Set
// SUMATRA_URL to fetch a different build.

const fs = require("fs");
const path = require("path");
const https = require("https");

const DEST_DIR = path.join(__dirname, "..", "resources", "sumatra");
const EXE = "SumatraPDF.exe";
// The zip ships a versioned name (SumatraPDF-3.6.1-32.exe); it gets flattened
// to SumatraPDF.exe, which is the only name main.js looks for.
const URL =
  process.env.SUMATRA_URL ||
  "https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1.zip";

function download(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("too many redirects"));
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(download(res.headers.location, redirects + 1));
        }
        if (res.statusCode !== 200)
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

async function main() {
  if (!fs.existsSync(DEST_DIR)) fs.mkdirSync(DEST_DIR, { recursive: true });
  const exePath = path.join(DEST_DIR, EXE);
  if (fs.existsSync(exePath) && fs.statSync(exePath).size > 500 * 1024) {
    console.log("[sumatra] already present:", exePath);
    return;
  }

  console.log("[sumatra] downloading:", URL);
  const buf = await download(URL);
  const zipPath = path.join(DEST_DIR, "sumatra.zip");
  fs.writeFileSync(zipPath, buf);

  // Unpack with PowerShell: no npm dependency, and it ships with Windows.
  const ps = `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${DEST_DIR}' -Force`;
  const { execFileSync } = require("child_process");
  execFileSync("powershell", ["-NoProfile", "-Command", ps], {
    stdio: "inherit",
  });
  fs.unlinkSync(zipPath);

  // The zip nests a versioned folder; flatten it so the path in main.js holds.
  const entries = fs.readdirSync(DEST_DIR);
  for (const e of entries) {
    const full = path.join(DEST_DIR, e);
    if (fs.statSync(full).isDirectory()) {
      for (const f of fs.readdirSync(full)) {
        if (/\.exe$/i.test(f)) {
          fs.copyFileSync(path.join(full, f), exePath);
          console.log("[sumatra] installed:", exePath);
          return;
        }
      }
    }
  }
  throw new Error("no .exe found inside the downloaded archive");
}

main().catch((err) => {
  console.error("[sumatra] failed:", err.message);
  console.error(
    "[sumatra] Place a portable SumatraPDF.exe in:",
    DEST_DIR,
    "\n          Printing then falls back to the browser print dialog.",
  );
  process.exitCode = 1;
});
