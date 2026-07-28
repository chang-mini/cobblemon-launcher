// ===================================================================
//  설치기 — Fabric 프로필 생성 + 모드 동기화
//
//  ⚠️ 모드 jar를 런처에 번들하지 않는다. 기획서 R7(라이선스) 대응:
//     RCT는 MCOML, CobbleDollars는 ARR이라 재배포가 걸린다.
//     Modrinth CDN에서 받고 SHA1로 검증하는 방식을 유지할 것.
// ===================================================================

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const https = require("https");

const pack = require("./pack.json");

const FABRIC_META = "https://meta.fabricmc.net/v2/versions/loader";

/** Fabric 프로필 폴더명 — minecraft-launcher-core 의 version.custom 에 넘길 값 */
function fabricVersionId() {
  return `fabric-loader-${pack.fabricLoader}-${pack.minecraft}`;
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "CobblemonLauncher/1.0" } }, (res) => {
      // Modrinth CDN 은 리다이렉트를 쓸 수 있다
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest, onProgress).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} — ${url}`));
      }
      const total = parseInt(res.headers["content-length"] || "0", 10);
      let got = 0;
      const out = fs.createWriteStream(dest);
      res.on("data", (c) => {
        got += c.length;
        if (onProgress && total) onProgress(got / total);
      });
      res.pipe(out);
      out.on("finish", () => out.close(resolve));
      out.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(120000, () => req.destroy(new Error(`타임아웃 — ${url}`)));
  });
}

async function sha1(file) {
  const h = crypto.createHash("sha1");
  h.update(await fsp.readFile(file));
  return h.digest("hex");
}

/** 파일이 존재하고 해시가 일치하면 true */
async function verified(file, expect) {
  try {
    await fsp.access(file);
    return (await sha1(file)) === expect;
  } catch {
    return false;
  }
}

// ── 1. Fabric 프로필 ────────────────────────────────────────────────
// Fabric 인스톨러 jar 를 돌리는 대신 meta API 의 프로필 JSON 을 직접 배치한다.
// minecraft-launcher-core 가 이 JSON 을 읽어 라이브러리를 해석한다.
async function ensureFabric(root, log) {
  const id = fabricVersionId();
  const dir = path.join(root, "versions", id);
  const json = path.join(dir, `${id}.json`);

  if (fs.existsSync(json)) {
    log(`Fabric 프로필 확인됨 — ${id}`);
    return id;
  }

  log(`Fabric 프로필 생성 중 — ${id}`);
  await fsp.mkdir(dir, { recursive: true });
  const url = `${FABRIC_META}/${pack.minecraft}/${pack.fabricLoader}/profile/json`;
  await download(url, json);

  // 받은 게 정상 JSON 인지 확인 — 깨진 파일을 남기면 다음 실행에서 조용히 실패한다
  try {
    JSON.parse(await fsp.readFile(json, "utf8"));
  } catch (e) {
    await fsp.rm(json, { force: true });
    throw new Error(`Fabric 프로필이 올바르지 않습니다: ${e.message}`);
  }
  return id;
}

// ── 2. 모드 동기화 ──────────────────────────────────────────────────
// 팩에 정의된 것만 남긴다. 해시가 다르면 다시 받고, 목록에 없는 jar 는 치운다.
async function syncMods(root, onStep) {
  const modsDir = path.join(root, "mods");
  await fsp.mkdir(modsDir, { recursive: true });

  const wanted = new Set(pack.mods.map((m) => m.file));
  let done = 0;

  for (const mod of pack.mods) {
    const dest = path.join(modsDir, mod.file);
    if (await verified(dest, mod.sha1)) {
      onStep({ name: mod.file, state: "cached", done: ++done, total: pack.mods.length });
      continue;
    }
    onStep({ name: mod.file, state: "downloading", done, total: pack.mods.length, ratio: 0 });
    await download(mod.url, dest, (ratio) =>
      onStep({ name: mod.file, state: "downloading", done, total: pack.mods.length, ratio })
    );

    if (!(await verified(dest, mod.sha1))) {
      await fsp.rm(dest, { force: true });
      throw new Error(`무결성 검증 실패 — ${mod.file}\n다시 시도해 주세요.`);
    }
    onStep({ name: mod.file, state: "done", done: ++done, total: pack.mods.length });
  }

  // 팩에 없는 jar 정리 — 버전이 섞이면 서버 접속이 거부된다 (기획서 R3)
  const removed = [];
  for (const f of await fsp.readdir(modsDir)) {
    if (f.endsWith(".jar") && !wanted.has(f)) {
      await fsp.rm(path.join(modsDir, f), { force: true });
      removed.push(f);
    }
  }
  return removed;
}

// ── 3. 배지 데이터팩 등 서버 리소스는 클라이언트에 불필요 ─────────────

module.exports = { ensureFabric, syncMods, fabricVersionId, pack };
