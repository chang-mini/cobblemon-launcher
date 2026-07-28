// ===================================================================
//  Microsoft 정품 인증 (msmc 5.x)
//
//  API 는 msmc 5.0.5 의 타입 정의를 직접 확인해 작성했다.
//    new Auth(prompt)            → msmc 내장 기본값 사용
//    new Auth({client_id, redirect, prompt})  → 우리 Azure 앱 사용
//    auth.launch("electron")     → Xbox
//    auth.refresh(refreshToken)  → Xbox
//    xbox.save()                 → refresh token (string)
//    xbox.getMinecraft()         → Minecraft
//    minecraft.mclc()            → minecraft-launcher-core 용 authorization
// ===================================================================

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

// ── Azure 앱 ────────────────────────────────────────────────────────
// Client ID 는 비밀값이 아니다 — 저장소에 커밋해도 된다.
const AZURE_CLIENT_ID = "b39a94e8-f321-417d-b12d-97f6cae1f03b";

// ⚠️ Azure 앱 등록의 "리디렉션 URI"와 **정확히 일치**해야 한다.
//    Azure → 인증 → 모바일 및 데스크톱 애플리케이션 에 등록된 값을 확인할 것.
//    불일치하면 로그인 창에서 redirect_uri 오류가 난다.
const AZURE_REDIRECT = "https://login.microsoftonline.com/common/oauth2/nativeclient";

// ── 승인 대기 중 스위치 ─────────────────────────────────────────────
//  false : msmc 내장 기본값(Mojang Client ID)으로 즉시 동작. 심사 불필요.
//          단 제3자가 Mojang 앱 ID를 쓰는 회색지대이므로 임시로만 쓸 것.
//  true  : 우리 Azure 앱 사용. aka.ms/mce-reviewappid 승인이 나야 로그인된다.
//
//  개발·테스트는 false 로, 승인이 나면 true 로 전환한다.
const USE_OWN_APP = true;

let Auth;
try {
  ({ Auth } = require("msmc"));
} catch {
  Auth = null; // npm install 전
}

function newAuth() {
  if (!Auth) throw new Error("msmc 가 설치되지 않았습니다. npm install 을 먼저 실행하세요.");
  return USE_OWN_APP
    ? new Auth({ client_id: AZURE_CLIENT_ID, redirect: AZURE_REDIRECT, prompt: "select_account" })
    : new Auth("select_account");
}

const tokenPath = (userData) => path.join(userData, "account.json");

// ── 에러 문구 ───────────────────────────────────────────────────────
// msmc 는 lexicon 코드(error.gui.closed 등)를 그대로 던진다.
// 코드 목록은 require("msmc").lexicon 으로 확인했다.
const MESSAGES = {
  "error.gui.closed":
    "로그인 창이 닫혔습니다. 다시 시도해 주세요.",
  "error.auth.microsoft":
    "Microsoft 계정 로그인에 실패했습니다.",
  "error.auth.xboxLive":
    "Xbox Live 로그인에 실패했습니다.",
  "error.auth.xsts.userNotFound":
    "이 Microsoft 계정에 Xbox 프로필이 없습니다.\n" +
    "xbox.com 에서 한 번 로그인해 프로필을 만든 뒤 다시 시도해 주세요.",
  "error.auth.xsts.bannedCountry":
    "Xbox Live 를 사용할 수 없는 국가의 계정입니다.",
  "error.auth.xsts.child":
    "미성년(만 18세 미만) 계정입니다. 보호자 계정의 가족 설정에서 승인이 필요합니다.",
  "error.auth.xsts.child.SK":
    "미성년 계정입니다. 한국 법령에 따라 Xbox 페이지에서 보호자 동의를 받아야 합니다.\n" +
    "xbox.com 에서 가족 설정을 완료한 뒤 다시 시도해 주세요.",
  // Microsoft·Xbox·XSTS 를 통과하고 여기서만 막히는 경우, 원인은 거의 항상
  // Azure 앱이 Minecraft API 사용 승인을 못 받은 것이다 (aka.ms/mce-reviewappid).
  "error.auth.minecraft.login":
    "Mojang 인증에 실패했습니다.\n" +
    "런처가 아직 Microsoft 승인 대기 중일 수 있습니다. 관리자에게 문의해 주세요.",
  "error.auth.minecraft.profile":
    "마인크래프트 프로필을 찾을 수 없습니다.\n" +
    "이 계정으로 마인크래프트 자바 에디션을 구매했는지 확인해 주세요.",
  "error.auth.minecraft.entitlements":
    "이 계정은 마인크래프트 자바 에디션을 보유하고 있지 않습니다.",
  "error.state.invalid.redirect":
    "리디렉션 URI 설정이 올바르지 않습니다. (관리자 문의)",
  "error.state.invalid.electron":
    "런처 내부 오류입니다. (관리자 문의)",
};

// 긴 코드부터 검사한다. error.auth.xsts.child.SK 가
// error.auth.xsts.child 보다 먼저 걸려야 한국 미성년 안내가 정확히 나간다.
const CODES = Object.keys(MESSAGES).sort((a, b) => b.length - a.length);

/** msmc 가 던진 값을 한글 메시지로 바꾼다. 모르는 코드는 원문을 남긴다. */
function friendly(e) {
  const raw = String(e?.message ?? e?.code ?? e ?? "");
  for (const code of CODES) {
    if (raw.includes(code)) return new Error(MESSAGES[code]);
  }
  // 미승인 앱 — Azure 심사 전이면 여기로 온다
  if (/unauthorized_client|AADSTS|not.*authorized|consent/i.test(raw)) {
    return new Error(
      "이 앱은 아직 Microsoft 승인을 받지 않았습니다.\n" + raw
    );
  }
  return e instanceof Error ? e : new Error(raw || "알 수 없는 로그인 오류");
}

/** 저장된 리프레시 토큰으로 조용히 재로그인. 실패하면 null */
async function tryRestore(userData) {
  if (!Auth) return null;
  const file = tokenPath(userData);
  if (!fs.existsSync(file)) return null;

  try {
    const saved = JSON.parse(await fsp.readFile(file, "utf8"));
    if (!saved.refresh) return null;

    const xbox = await newAuth().refresh(saved.refresh);
    return finish(xbox, await xbox.getMinecraft(), userData);
  } catch {
    // 토큰 만료·앱 전환 등 — 조용히 전체 로그인으로 떨어진다
    await fsp.rm(file, { force: true }).catch(() => {});
    return null;
  }
}

/** 로그인 창을 띄운다 */
async function login(userData) {
  try {
    const xbox = await newAuth().launch("electron");
    return finish(xbox, await xbox.getMinecraft(), userData);
  } catch (e) {
    throw friendly(e);
  }
}

async function finish(xbox, mc, userData) {
  // 리프레시 토큰 저장 — 다음 실행에서 로그인 창을 건너뛴다
  try {
    const refresh = xbox.save();
    if (refresh) {
      await fsp.mkdir(userData, { recursive: true });
      await fsp.writeFile(tokenPath(userData), JSON.stringify({ refresh }), { mode: 0o600 });
    }
  } catch { /* 저장 실패는 치명적이지 않다 — 다음에 다시 로그인하면 된다 */ }

  const auth = mc.mclc();
  return { auth, profile: { name: auth.name, uuid: auth.uuid } };
}

async function logout(userData) {
  await fsp.rm(tokenPath(userData), { force: true }).catch(() => {});
}

module.exports = { tryRestore, login, logout, AZURE_CLIENT_ID, USE_OWN_APP };
