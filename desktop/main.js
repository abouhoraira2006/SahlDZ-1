const { app, BrowserWindow, ipcMain, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const { autoUpdater } = require("electron-updater");

// ─── Configuration ────────────────────────────────────────────
// The desktop always boots straight into the unified staff login:
// activation code → employee → PIN.
// Production build connects to the sahldz.com server. Override via
// APP_BASE_URL (e.g. the local dev server) when needed.
const DEFAULT_BASE = process.env.APP_BASE_URL || "https://sahldz.com";
const APP_URL =
  (process.env.VITE_DEV_SERVER_URL || DEFAULT_BASE) + "/staff-login";
const configPath = path.join(app.getPath("userData"), "config.json");

// ─── Helpers ──────────────────────────────────────────────────
function checkServer(url, timeout = 3000) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, { timeout }, (res) => {
      resolve(res.statusCode < 400);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

// ─── Config Management ────────────────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (err) {
    console.error("[CONFIG] Load failed:", err.message);
  }
  return null;
}

function saveConfig(config) {
  try {
    const dir = path.dirname(configPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    console.error("[CONFIG] Save failed:", err.message);
    return false;
  }
}

function clearConfig() {
  try {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    return true;
  } catch {
    return false;
  }
}

// ─── Window ───────────────────────────────────────────────────
let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: "SahlDZ",
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    autoHideMenuBar: true,
    show: false,
    backgroundColor: "#141210",
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http")) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("dom-ready", () => {
    mainWindow.webContents.executeJavaScript(
      `window.__ELECTRON__=true;`
    ).catch(() => {});
  });

  navigateToApp();
}

function loadOfflinePage(type) {
  const page = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:#141210;color:#f0ece6;min-height:100vh;display:flex;align-items:center;
      justify-content:center;direction:rtl}
    .box{text-align:center;max-width:420px;padding:40px}
    .icon{width:72px;height:72px;border-radius:16px;margin:0 auto 24px;
      display:flex;align-items:center;justify-content:center;font-size:32px}
    .icon.wait{background:#1e1c18;border:2px solid #d4a84a}
    .icon.err{background:rgba(220,38,38,0.1);border:2px solid rgba(220,38,38,0.3)}
    h1{font-size:22px;margin-bottom:8px}
    p{color:#8a8580;font-size:14px;line-height:1.8;margin-bottom:24px}
    .btn{display:inline-block;padding:10px 28px;border-radius:10px;border:none;
      background:#d4a84a;color:#141210;font-size:14px;font-weight:600;cursor:pointer}
    .btn:hover{opacity:0.9}
    .details{margin-top:16px;padding:12px;border-radius:8px;background:#1e1c18;
      font-size:12px;color:#5a5550;font-family:monospace}
  </style>
</head>
<body>
  <div class="box">
    ${type === "waiting"
      ? `<div class="icon wait" style="font-family:monospace;color:#d4a84a">S</div>
         <h1>SahlDZ</h1>
         <p>جاري الاتصال بالخادم...</p>
         <div class="details">${APP_URL}</div>`
      : `<div class="icon err" style="color:#f87171">X</div>
         <h1>تعذر الاتصال</h1>
         <p>تعذّر الوصول إلى الخدمة. تحقق من اتصالك بالإنترنت ثم أعد المحاولة.</p>
         <div class="details">${APP_URL}</div>
         <br>
         <button class="btn" onclick="location.reload()">إعادة المحاولة</button>`
    }
  </div>
</body>
</html>`;

  const tempFile = path.join(app.getPath("temp"), `sahldz-${type}.html`);
  fs.writeFileSync(tempFile, page, "utf8");
  return mainWindow.loadFile(tempFile);
}

async function navigateToApp() {
  console.log("[NAV] Checking server:", APP_URL);
  loadOfflinePage("waiting");

  let retries = 0;
  const maxRetries = 10;
  const interval = 2000;

  const tryConnect = async () => {
    const alive = await checkServer(APP_URL);
    if (alive) {
      console.log("[NAV] Server is up, loading app");
      mainWindow.loadURL(APP_URL);
    } else if (retries < maxRetries) {
      retries++;
      console.log(`[NAV] Server not ready, retry ${retries}/${maxRetries}`);
      setTimeout(tryConnect, interval);
    } else {
      console.log("[NAV] Server unreachable, showing error");
      loadOfflinePage("error");
    }
  };

  await tryConnect();
}

// ─── IPC ──────────────────────────────────────────────────────
ipcMain.handle("get-config", () => loadConfig());
ipcMain.handle("save-config", (_, config) => saveConfig(config));
ipcMain.handle("clear-config", () => clearConfig());
ipcMain.handle("reload-app", () => navigateToApp());
ipcMain.handle("get-app-version", () => app.getVersion());
ipcMain.handle("get-platform", () => process.platform);
ipcMain.handle("open-external", (_, url) => shell.openExternal(url));
ipcMain.handle("get-app-url", () => APP_URL);
ipcMain.handle("logout", () => { clearConfig(); navigateToApp(); });

// ─── Kitchen printing (silent, per-station) ────────────────────
// A kitchen ticket is produced by Electron itself so Arabic + RTL stay intact,
// then handed to SumatraPDF, which prints it to the exact printer chosen in
// the kitchen settings without ever showing a print dialog on the terminal.
// Windows-only: on any other platform the renderer falls back to window.print().

const PRINT_JOBS_DIR = path.join(app.getPath("temp"), "sahldz-print");
const SUMATRA_NAMES = ["SumatraPDF.exe", "SumatraPDF-3.6.1-32.exe", "SumatraPDF-3.5.2-32.exe"];

function sumatraPath() {
  const packaged = path.join(process.resourcesPath || "", "sumatra");
  const dev = path.join(__dirname, "resources", "sumatra");
  for (const dir of [packaged, dev]) {
    for (const name of SUMATRA_NAMES) {
      const p = path.join(dir, name);
      try {
        if (fs.existsSync(p)) return p;
      } catch { /* not packaged */ }
    }
  }
  return null;
}

function ensureJobsDir() {
  if (!fs.existsSync(PRINT_JOBS_DIR)) fs.mkdirSync(PRINT_JOBS_DIR, { recursive: true });
  return PRINT_JOBS_DIR;
}

/** IPC: every printer Windows knows about, so the settings page can list them. */
ipcMain.handle("printers-list", async () => {
  if (process.platform !== "win32") return [];
  try {
    const printers = await mainWindow.webContents.getPrinters();
    return printers.map((p) => ({ name: p.name, isDefault: p.isDefault }));
  } catch (err) {
    console.warn("[PRINT] getPrinters failed:", err && err.message);
    return [];
  }
});

/**
 * IPC: render `html` to a PDF, then silently print it.
 *
 * A hidden BrowserWindow does the rendering so the ticket inherits the app's
 * fonts and RTL rules, and printToPDF avoids depending on a printer driver
 * during generation. `printerName` of null/empty prints to the system default.
 */
ipcMain.handle("print-ticket", async (event, opts) => {
  const { html, printerName, copies, jobName } = opts || {};
  if (typeof html !== "string" || !html.trim())
    throw new Error("محتوى التذكرة فارغ");
  if (process.platform !== "win32")
    return { ok: false, reason: "unsupported-platform" };

  const exe = sumatraPath();
  if (!exe) return { ok: false, reason: "sumatra-missing" };

  const dir = ensureJobsDir();
  // Sequence + pid keeps concurrent stations from clobbering each other's file.
  const safe = String(jobName || "ticket")
    .replace(/[^A-Za-z0-9-_]/g, "")
    .slice(0, 24) || "ticket";
  const pdfPath = path.join(dir, `${safe}-${Date.now()}-${process.pid}.pdf`);
  const htmlPath = path.join(dir, `${safe}-${Date.now()}-${process.pid}.html`);

  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true },
  });
  try {
    fs.writeFileSync(htmlPath, html, "utf8");
    await win.loadFile(htmlPath);
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      // The ticket CSS declares `@page { size: 80mm auto; margin: 4mm }` for the
      // thermal roll. An explicit pageSize would override that and render the
      // ticket onto A4, so the CSS must drive the paper size and margin.
      preferCSSPageSize: true,
    });
    fs.writeFileSync(pdfPath, pdf);

    const n = Math.min(Math.max(Number(copies) || 1, 1), 9);
    // -silent is what keeps the print dialog from ever appearing on the
    // terminal. An empty -print-to value targets the system default printer.
    const args = ["-silent", "-nologo"];
    if (printerName) args.push("-print-to", String(printerName));
    for (let i = 0; i < n; i += 1) args.push(pdfPath);

    // SUMATRA keeps running as a GUI process; we only need it to have handed
    // the job to the spooler, so detach and clean up on our side.
    const child = spawn(exe, args, { detached: true, stdio: "ignore" });
    child.unref();

    // The PDF is already in the spooler; the scratch files are ours to remove.
    setTimeout(() => {
      for (const p of [pdfPath, htmlPath]) {
        try { fs.unlinkSync(p); } catch { /* already gone */ }
      }
    }, 30000);

    return { ok: true, printer: printerName || null, copies: n };
  } catch (err) {
    for (const p of [pdfPath, htmlPath]) {
      try { fs.unlinkSync(p); } catch { /* already gone */ }
    }
    throw new Error("فشل توليد التذكرة: " + (err && err.message));
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
});

/** IPC: probe for Sumatra so the UI can warn before a ticket is lost. */
ipcMain.handle("print-capabilities", async () => {
  if (process.platform !== "win32")
    return { supported: false, sumatra: false, reason: "unsupported-platform" };
  const exe = sumatraPath();
  return { supported: true, sumatra: !!exe, tempDir: os.tmpdir() };
});
// ─── Auto Update ──────────────────────────────────────────────
// Windows 7 SP1 is still a target for the cashier/kitchen terminals, and those
// machines sit behind flaky links.  Only phones home when the OS is new
// enough to be worth it, and never let a missing/failing feed break the app.
const osRelease = () => {
  try {
    const r = process.getSystemVersion(); // "6.1" on Win7, "10.0" on Win10+
    const [major, minor] = String(r).split(".").map(Number);
    return { major: major || 0, minor: minor || 0, text: String(r) };
  } catch {
    return { major: 0, minor: 0, text: "unknown" };
  }
};

// 6.1 = Windows 7, 6.2 = Windows 8, 6.3 = Windows 8.1, 10.0 = Windows 10+
const isLegacyWindows = () => {
  const { major } = osRelease();
  return major < 10;
};

const UPDATES_ENABLED = !isLegacyWindows();

const checkForUpdates = () => {
  if (!UPDATES_ENABLED) return Promise.resolve(null);
  return autoUpdater
    .checkForUpdates()
    .catch((err) => {
      // A 404/missing feed is expected on some deployments - stay silent.
      console.warn("[UPDATE] check skipped:", err && err.message);
      return null;
    });
};

ipcMain.handle("check-for-updates", () => checkForUpdates());
ipcMain.handle("install-update", () => {
  if (!UPDATES_ENABLED) return false;
  autoUpdater.quitAndInstall();
  return true;
});

autoUpdater.autoDownload = UPDATES_ENABLED;
autoUpdater.autoInstallOnAppQuit = UPDATES_ENABLED;
autoUpdater.logger = {
  info: (m) => console.log("[UPDATE]", m),
  warn: (m) => console.warn("[UPDATE]", m),
  error: (m) => console.error("[UPDATE]", m),
};

autoUpdater.on("update-available", (info) => {
  if (mainWindow) mainWindow.webContents.send("update-available", { version: info.version });
});
autoUpdater.on("download-progress", (p) => {
  if (mainWindow) mainWindow.webContents.send("update-progress", { percent: Math.round(p.percent) });
});
autoUpdater.on("update-downloaded", (info) => {
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "تحديث جديد",
      message: "تم تحميل التحديث " + info.version,
      detail: "سيتم إعادة تشغيل التطبيق لتطبيق التحديث.",
      buttons: ["إعادة التشغيل", "لاحقاً"],
    }).then(({ response }) => { if (response === 0) autoUpdater.quitAndInstall(); });
  }
});
autoUpdater.on("error", (err) => console.warn("[UPDATE]", err.message));

// ─── Lifecycle ────────────────────────────────────────────────
let gotTheLock = true;
try { gotTheLock = app.requestSingleLock ? app.requestSingleLock() !== "denied" : true; } catch { gotTheLock = true; }

if (!gotTheLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createMainWindow();
    if (UPDATES_ENABLED) setTimeout(() => checkForUpdates(), 10000);
    app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createMainWindow(); });
  });
}

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { if (UPDATES_ENABLED) autoUpdater.removeAllListeners(); });
