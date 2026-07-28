// ===================================================================
//  Cobblemon Launcher — Electron 메인 프로세스
// ===================================================================

const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");

const auth = require("./auth");
const { ensureFabric, syncMods, fabricVersionId, pack } = require("./installer");

const SERVER = { host: "", port: 25565 }; // 배포 전 채울 것 (DDoS 프록시 주소 권장)

let win = null;
let account = null; // { auth, profile }

// 게임 설치 위치 — 공식 런처와 섞이지 않도록 전용 폴더를 쓴다
function gameRoot() {
  return path.join(app.getPath("appData"), ".cobblemon");
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

async function loadSettings() {
  try {
    return JSON.parse(await fsp.readFile(settingsPath(), "utf8"));
  } catch {
    // 물리 RAM 의 절반, 4~8GB 로 클램프
    const half = Math.floor(os.totalmem() / 1024 / 1024 / 1024 / 2);
    return { ramGB: Math.min(8, Math.max(4, half)) };
  }
}

async function saveSettings(s) {
  await fsp.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fsp.writeFile(settingsPath(), JSON.stringify(s, null, 2));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 940,
    height: 600,
    resizable: false,
    autoHideMenuBar: true,
    backgroundColor: "#12151c",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "..", "ui", "index.html"));

  // 외부 링크는 기본 브라우저로
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  createWindow();

  // 저장된 계정으로 조용히 복구 시도
  const restored = await auth.tryRestore(app.getPath("userData"));
  if (restored) {
    account = restored;
    send("account", restored.profile);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ── IPC ─────────────────────────────────────────────────────────────

ipcMain.handle("pack-info", async () => ({
  name: pack.name,
  packVersion: pack.packVersion,
  minecraft: pack.minecraft,
  fabricLoader: pack.fabricLoader,
  modCount: pack.mods.length,
  totalMB: +(pack.mods.reduce((a, m) => a + m.size, 0) / 1024 / 1024).toFixed(1),
  server: SERVER,
  settings: await loadSettings(),
  hasClientId: !!auth.AZURE_CLIENT_ID,
  useOwnApp: auth.USE_OWN_APP,
}));

ipcMain.handle("login", async () => {
  account = await auth.login(app.getPath("userData"));
  return account.profile;
});

ipcMain.handle("logout", async () => {
  await auth.logout(app.getPath("userData"));
  account = null;
});

ipcMain.handle("set-ram", async (_e, ramGB) => {
  const s = await loadSettings();
  s.ramGB = ramGB;
  await saveSettings(s);
  return s;
});

ipcMain.handle("play", async () => {
  if (!account) throw new Error("먼저 로그인해 주세요.");

  const root = gameRoot();
  await fsp.mkdir(root, { recursive: true });

  send("status", { phase: "fabric", text: "Fabric 확인 중…" });
  const versionId = await ensureFabric(root, (m) => send("log", m));

  send("status", { phase: "mods", text: "모드 확인 중…" });
  const removed = await syncMods(root, (s) => send("mod-progress", s));
  if (removed.length) send("log", `팩에 없는 모드 ${removed.length}개를 정리했습니다.`);

  const { ramGB } = await loadSettings();

  // minecraft-launcher-core 는 실행 시점에만 필요하다 (설치 전 require 실패 방지)
  const { Client } = require("minecraft-launcher-core");
  const launcher = new Client();

  send("status", { phase: "game", text: "게임 파일 확인 중…" });

  launcher.on("progress", (e) => send("dl-progress", e));
  launcher.on("debug", (m) => send("log", String(m)));
  launcher.on("data", (m) => send("log", String(m)));
  launcher.on("close", (code) => send("closed", code));

  await launcher.launch({
    authorization: account.auth,
    root,
    version: { number: pack.minecraft, type: "release", custom: versionId },
    memory: { max: `${ramGB}G`, min: "2G" },
    // 서버 주소를 넘기면 게임 시작 직후 자동 접속한다
    ...(SERVER.host ? { quickPlay: { type: "multiplayer", identifier: `${SERVER.host}:${SERVER.port}` } } : {}),
  });

  send("status", { phase: "launched", text: "실행 중" });
  return true;
});

ipcMain.handle("open-folder", async () => {
  const root = gameRoot();
  await fsp.mkdir(root, { recursive: true });
  shell.openPath(root);
});
