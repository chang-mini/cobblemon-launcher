const $ = (id) => document.getElementById(id);
const L = window.launcher;

let signedIn = false;
let busy = false;

function setStatus(text) { $("statusText").textContent = text; }
function setDetail(text) { $("detail").textContent = text || ""; }
function setBar(ratio) { $("bar").style.width = `${Math.max(0, Math.min(1, ratio)) * 100}%`; }

function log(line) {
  const el = $("log");
  el.textContent += line + "\n";
  if (el.textContent.length > 60000) el.textContent = el.textContent.slice(-40000);
  el.scrollTop = el.scrollHeight;
}

function refreshPlay() {
  $("play").disabled = !signedIn || busy;
}

// ── 초기화 ──────────────────────────────────────────────────────────
(async () => {
  const info = await L.packInfo();
  $("packline").textContent =
    `Minecraft ${info.minecraft} · Fabric ${info.fabricLoader} · 모드 ${info.modCount}개 (${info.totalMB}MB)`;
  $("ram").value = String(info.settings.ramGB);

  if (!info.hasClientId) {
    setStatus("Azure Client ID 미설정");
    setDetail("src/auth.js 의 AZURE_CLIENT_ID 를 채워야 로그인할 수 있습니다.");
    $("login").disabled = true;
  } else if (info.useOwnApp) {
    setDetail("자체 Azure 앱 사용 중 — 심사 미승인 시 로그인이 거부됩니다.");
  }
})();

// ── 이벤트 ──────────────────────────────────────────────────────────
L.on("account", (p) => {
  signedIn = true;
  $("login").classList.add("hidden");
  $("who").classList.remove("hidden");
  $("nick").textContent = p.name;
  $("skin").src = `https://mc-heads.net/avatar/${p.uuid}/32`;
  setStatus("플레이할 준비가 됐습니다.");
  refreshPlay();
});

L.on("status", (s) => setStatus(s.text));
L.on("log", (m) => log(m));

L.on("mod-progress", (s) => {
  const pct = s.state === "downloading" && s.ratio != null
    ? ` — ${Math.round(s.ratio * 100)}%`
    : "";
  setDetail(`모드 ${s.done}/${s.total} · ${s.name}${pct}`);
  setBar((s.done + (s.ratio || 0)) / s.total);
});

L.on("dl-progress", (e) => {
  if (!e || !e.total) return;
  setDetail(`${e.type} · ${e.task}/${e.total}`);
  setBar(e.task / e.total);
});

L.on("closed", (code) => {
  busy = false;
  setBar(0);
  setStatus(code === 0 ? "게임이 종료되었습니다." : `게임이 종료되었습니다 (코드 ${code})`);
  setDetail("");
  refreshPlay();
});

// ── 조작 ────────────────────────────────────────────────────────────
$("login").onclick = async () => {
  try {
    setStatus("Microsoft 로그인 창을 여는 중…");
    const p = await L.login();
    signedIn = true;
    $("login").classList.add("hidden");
    $("who").classList.remove("hidden");
    $("nick").textContent = p.name;
    $("skin").src = `https://mc-heads.net/avatar/${p.uuid}/32`;
    setStatus("플레이할 준비가 됐습니다.");
    refreshPlay();
  } catch (e) {
    setStatus("로그인 실패");
    setDetail(String(e.message || e).split("\n")[0]);
    log(String(e.message || e));
  }
};

$("logout").onclick = async () => {
  await L.logout();
  signedIn = false;
  $("who").classList.add("hidden");
  $("login").classList.remove("hidden");
  setStatus("로그인 후 플레이할 수 있습니다.");
  refreshPlay();
};

$("ram").onchange = (e) => L.setRam(Number(e.target.value));
$("folder").onclick = () => L.openFolder();

$("play").onclick = async () => {
  busy = true;
  refreshPlay();
  setDetail("");
  try {
    await L.play();
  } catch (e) {
    busy = false;
    setBar(0);
    setStatus("실행 실패");
    setDetail(String(e.message || e).split("\n")[0]);
    log(String(e.message || e));
    refreshPlay();
  }
};
