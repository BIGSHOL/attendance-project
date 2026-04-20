/**
 * 시트-vs-UI 급여 일치율 검증 하네스.
 *
 * 한 선생님 시트의 "보수" (R3[25]) 또는 학생별 실급여 합 을 "시트 기대값" 으로,
 * DB 의 attendance_records + payment_shares + payments 로 재계산한 합을 "UI 값" 으로
 * 비교하여 regression baseline 으로 사용.
 *
 * 요구사항:
 *   - dev server 가 3002 포트에서 떠 있어야 함
 *   - .env.local 에 DEV_BYPASS_PASSWORD, DEV_BYPASS_SECRET, 서비스 계정 설정
 *
 * 사용:
 *   node scripts/verifySalary.mjs [--month=2026-03] [--teacher=추민아] [--update-snapshot]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

// ----- env 로드 -----
function loadEnvFile(p) {
  try {
    const txt = readFileSync(p, "utf-8");
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  } catch {}
}
loadEnvFile(join(PROJECT_ROOT, ".env.local"));
loadEnvFile("D:/attendance/.env.local");

// ----- 인자 -----
const args = process.argv.slice(2);
const argVal = (name, def = null) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const argFlag = (n) => args.includes(`--${n}`);
const MONTH = argVal("month", "2026-03");
const FILTER_TEACHER = argVal("teacher", null);
const UPDATE_SNAPSHOT = argFlag("update-snapshot");
const TOLERANCE = parseInt(argVal("tolerance", "50"), 10);
const HOST = argVal("host", "http://localhost:3002");

// ----- dev-login -----
const DEV_PW = process.env.DEV_BYPASS_PASSWORD;
if (!DEV_PW) {
  console.error("DEV_BYPASS_PASSWORD 미설정.");
  process.exit(1);
}
const loginRes = await fetch(`${HOST}/api/dev-login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: DEV_PW }),
});
if (!loginRes.ok) {
  console.error("dev-login 실패:", loginRes.status);
  process.exit(1);
}
const setCookies = loginRes.headers.getSetCookie?.() || [];
const cookies = setCookies.map((c) => c.split(";")[0]).join("; ");
const H = { Cookie: cookies };

async function api(path, opts = {}) {
  const res = await fetch(`${HOST}${path}`, {
    ...opts,
    headers: { ...H, ...(opts.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ----- 데이터 로드 -----
const sheets = await api("/api/teacher-sheets");
const config = await api("/api/salary-config");
const ACADEMY_FEE = config?.academyFee ?? 8.9;
const ITEMS = config?.items || [];
const TEACHER_RATIOS = config?.teacherRatios || {};

// tier 매칭 — (name, subject) 우선, 없으면 name 만
function findItem(name, subject) {
  if (!name) return null;
  return (
    ITEMS.find((i) => i.name === name && i.subject === subject) ||
    ITEMS.find((i) => i.name === name) ||
    null
  );
}

// 선생님 비율 — "이름" 또는 "이름(영어명)" 형식 모두 대응
function getTeacherRatios(fullName) {
  if (!fullName) return null;
  // "추민아(Jane)" → "추민아"
  const baseName = fullName.replace(/\(.*\)$/, "").trim();
  return (
    TEACHER_RATIOS[fullName] ||
    TEACHER_RATIOS[baseName] ||
    Object.entries(TEACHER_RATIOS).find(([k]) =>
      k.startsWith(baseName + "(")
    )?.[1] ||
    null
  );
}

// floor1 (소수 1자리 내림)
const floor1 = (n) => Math.floor(n * 10) / 10;

// ----- 선생님 1인 검증 -----
async function verifyTeacher(sheet) {
  // 1. 시트 기대값 가져오기
  const expected = await api(
    `/api/admin/verify-salary?sheet_url=${encodeURIComponent(sheet.sheet_url)}&month=${MONTH}`
  );
  const teacherName = expected.teacherName;
  const subject = detectSubject(expected);

  // 2. payment_shares 기반 UI 총액 (영어 선생님)
  // teacher_staff_id 는 staff.id ("Jane 추민아" 등). sheet.teacher_id 는 Firebase doc id —
  // payment_shares 는 staff.id 로 저장되므로 teacher_id 와 다를 수 있다. 안전하게 이름으로 매칭.
  const params = new URLSearchParams({ month: MONTH });
  const allShares = await api(`/api/payment-shares?${params.toString()}`);
  // teacherName 에서 담임명을 뽑아 staff.id 규칙 "{englishName} {koreanName}" 에 매칭.
  // 예: "추민아(Jane)" → staff.id 후보 "Jane 추민아"
  const m = teacherName?.match(/^(.+?)\((.+?)\)\s*$/);
  const korName = m ? m[1].trim() : teacherName;
  const engName = m ? m[2].trim() : null;
  const staffIdCandidates = [
    teacherName,
    korName,
    engName && korName ? `${engName} ${korName}` : null,
    engName && korName ? `${korName} ${engName}` : null,
  ].filter(Boolean);

  const shares = allShares.filter((s) =>
    staffIdCandidates.some((c) => s.teacher_staff_id === c)
  );

  const tRatios = getTeacherRatios(teacherName);

  let uiTotal = null;
  if (shares.length > 0) {
    uiTotal = 0;
    for (const sh of shares) {
      const item = findItem(sh.class_name, subject);
      const group = item?.group;
      let ratio =
        (tRatios?.[subject]?.[group] ?? item?.ratio) ?? 45;
      const paid = sh.allocated_paid || 0;
      // UI 와 동일한 cap: effectiveUnitPrice × classUnits
      // classUnits 를 attendance_records 에서 가져와야 하지만 편의상 allocated_units
      // 또는 paid/unit_price 로 근사 (시트 unit_price=paid/units 이 일반적).
      const unitPrice = sh.unit_price || item?.baseTuition || 0;
      const units =
        sh.allocated_units ??
        (unitPrice > 0 ? paid / unitPrice : 0);
      const gross = unitPrice > 0 ? floor1(unitPrice * units) : paid;
      const base = Math.min(paid, gross || paid);
      uiTotal += floor1(base * (1 - ACADEMY_FEE / 100) * (ratio / 100));
    }
    uiTotal = Math.floor(uiTotal);
  }

  // 시트 기대값: R3 우선, 없으면 학생별 실급여 합 (수학 시트 대응)
  const sheetTotal = expected.sheetTotal ?? expected.computedTotal ?? 0;
  const diff = uiTotal !== null ? uiTotal - sheetTotal : null;

  return {
    teacherName,
    teacherId: sheet.teacher_id,
    subject,
    sheetTotal,
    uiTotal,
    diff,
    studentCount: expected.studentCount,
    sharesCount: shares.length,
    status:
      diff === null
        ? "UI_NA"
        : Math.abs(diff) <= TOLERANCE
          ? "OK"
          : Math.abs(diff) <= sheetTotal * 0.01
            ? "WARN"
            : "FAIL",
  };
}

// subject 추정 — tier 이름에 "EIE"/"브릿지"/"영어" 포함되면 english
function detectSubject(expected) {
  const tiers = (expected.perStudent || []).map((p) => p.tier).filter(Boolean);
  const joined = tiers.join(" ");
  if (/EIE|브릿지|인재원|영어|Writing|Reading|Phonics|JP|SP/i.test(joined))
    return "english";
  if (/미적|확통|킬러|수능|수학/.test(joined)) return "math";
  // tier 이름 다수가 english items 에 매칭되면 english
  const engHits = tiers.filter((t) =>
    ITEMS.some((i) => i.name === t && i.subject === "english")
  ).length;
  const mathHits = tiers.filter((t) =>
    ITEMS.some((i) => i.name === t && i.subject === "math")
  ).length;
  return engHits >= mathHits ? "english" : "math";
}

// ----- 실행 -----
const results = [];
for (const sheet of sheets) {
  if (!sheet.sheet_url) continue;
  try {
    const r = await verifyTeacher(sheet);
    if (FILTER_TEACHER && !(r.teacherName || "").includes(FILTER_TEACHER)) continue;
    results.push(r);
  } catch (e) {
    results.push({
      teacherId: sheet.teacher_id,
      error: e.message,
      status: "ERR",
    });
  }
}

// ----- 출력 -----
const fmt = (n) => {
  if (n === null || n === undefined) return "        -";
  return Math.round(n).toLocaleString().padStart(11);
};

console.log("\n================ 급여 검증 리포트 ================");
console.log(`월: ${MONTH}  |  허용: ±${TOLERANCE}원  |  총: ${results.length}명`);
console.log("".padEnd(85, "-"));
console.log(
  [
    "선생님".padEnd(14),
    "과목".padEnd(6),
    "시트".padStart(11),
    "UI".padStart(11),
    "diff".padStart(10),
    "학생".padStart(5),
    "상태".padStart(6),
  ].join("  ")
);
console.log("".padEnd(85, "-"));

results.sort((a, b) => (a.teacherName || "").localeCompare(b.teacherName || ""));
let ok = 0, warn = 0, fail = 0, err = 0, nan = 0;
for (const r of results) {
  if (r.error) {
    console.log(
      `${(r.teacherId || "-").padEnd(14).slice(0, 14)}  -      ${"ERR".padStart(6)}  ${r.error.slice(0, 60)}`
    );
    err++;
    continue;
  }
  const statusColor = {
    OK: "✓",
    WARN: "⚠",
    FAIL: "✗",
    UI_NA: "?",
  }[r.status] || "?";
  const line = [
    (r.teacherName || r.teacherId || "-").slice(0, 14).padEnd(14),
    (r.subject || "-").padEnd(6),
    fmt(r.sheetTotal),
    r.uiTotal !== null ? fmt(r.uiTotal) : "       N/A".padStart(11),
    r.diff !== null ? String(r.diff).padStart(10) : "        -",
    String(r.studentCount ?? "-").padStart(5),
    (statusColor + " " + r.status).padStart(6),
  ].join("  ");
  console.log(line);
  if (r.status === "OK") ok++;
  else if (r.status === "WARN") warn++;
  else if (r.status === "FAIL") fail++;
  else nan++;
}
console.log("".padEnd(85, "-"));
console.log(`요약: OK=${ok}  WARN=${warn}  FAIL=${fail}  UI_NA=${nan}  ERR=${err}`);

// ----- snapshot -----
const snapshotDir = join(PROJECT_ROOT, "snapshots");
if (!existsSync(snapshotDir)) mkdirSync(snapshotDir, { recursive: true });
const snapshotFile = join(snapshotDir, `salary-${MONTH}.json`);

const snapshot = {
  month: MONTH,
  capturedAt: new Date().toISOString(),
  tolerance: TOLERANCE,
  teachers: Object.fromEntries(
    results.map((r) => [r.teacherName || r.teacherId, r])
  ),
};

let prior = null;
if (existsSync(snapshotFile)) {
  try {
    prior = JSON.parse(readFileSync(snapshotFile, "utf-8"));
  } catch {}
}

if (UPDATE_SNAPSHOT || !prior) {
  writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2), "utf-8");
  console.log(`\n[snapshot] ${snapshotFile} ${prior ? "갱신" : "생성"}됨.`);
  process.exit(fail > 0 ? 1 : 0);
}

let regressed = 0;
for (const [name, cur] of Object.entries(snapshot.teachers)) {
  const old = prior.teachers?.[name];
  if (!old || cur.diff === null || old.diff === null) continue;
  if (Math.abs(cur.diff) > Math.abs(old.diff) + TOLERANCE) {
    console.log(
      `❌ ${name} regression: ${old.diff} → ${cur.diff} (\u0394${cur.diff - old.diff})`
    );
    regressed++;
  }
}
console.log(
  regressed > 0
    ? `\n⚠️  ${regressed}명 regression — --update-snapshot 로 baseline 갱신 가능.`
    : `\n✅ regression 없음.`
);
process.exit(regressed > 0 || fail > 0 ? 1 : 0);
