// 김화영 시트 한 탭을 서비스 계정으로 읽어서 덤프
// 사용: node scripts/dumpSheet.mjs <spreadsheetId> <gid>
import { JWT } from "google-auth-library";
import { readFileSync } from "fs";

// 수동 .env.local 파싱
const envPath = process.env.ENV_PATH || "D:/attendance/.env.local";
try {
  const envText = readFileSync(envPath, "utf-8");
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
} catch (e) {
  console.error("env 읽기 실패:", e.message);
}

const spreadsheetId = process.argv[2] || "127K5FIoY2uMYtvBA8B8ZxZ1oDvMfYI0mDY7fvPCNKVw";
const targetGid = process.argv[3] ? Number(process.argv[3]) : null;

const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
if (!email || !privateKey) {
  // try path fallback
  const path = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  if (path) {
    const j = JSON.parse(readFileSync(path, "utf-8"));
    privateKey = j.private_key;
  }
}
privateKey = (privateKey || "").replace(/\\n/g, "\n");

const jwt = new JWT({
  email,
  key: privateKey,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const { token } = await jwt.getAccessToken();

// 1. 메타
const metaRes = await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const meta = await metaRes.json();
if (!metaRes.ok) {
  console.error("META ERR:", meta);
  process.exit(1);
}
console.log("=== 탭 목록 ===");
for (const s of meta.sheets) {
  const p = s.properties;
  console.log(`  gid=${p.sheetId}  title="${p.title}"`);
}

// 2. 타겟 탭 결정
let targetTitle;
if (targetGid !== null) {
  const found = meta.sheets.find((s) => s.properties.sheetId === targetGid);
  if (!found) {
    console.error(`gid ${targetGid} 탭 없음`);
    process.exit(1);
  }
  targetTitle = found.properties.title;
} else {
  // 월별 탭(yy.mm) 중 최신
  const monthTabs = meta.sheets
    .map((s) => s.properties.title)
    .filter((t) => /^\d{2}\.\d{1,2}$/.test(t))
    .sort();
  targetTitle = monthTabs[monthTabs.length - 1];
}
console.log(`\n=== 선택 탭: ${targetTitle} ===`);

// 3. 값+메모 (범위 인자 4번째, 기본 1000행)
const maxRow = process.argv[4] || "1000";
const range = `${targetTitle}!A1:AZ${maxRow}`;
const url =
  `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
  `?ranges=${encodeURIComponent(range)}&includeGridData=true`;
const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
const data = await res.json();
if (!res.ok) {
  console.error("GRID ERR:", data);
  process.exit(1);
}
const rowData = data.sheets?.[0]?.data?.[0]?.rowData || [];

for (let r = 0; r < rowData.length; r++) {
  const cells = rowData[r]?.values || [];
  const row = cells.map((c) => (c?.formattedValue ?? "").toString().replace(/\s+/g, " "));
  // 완전히 빈 행 스킵
  if (row.every((v) => !v)) continue;
  console.log(`R${(r + 1).toString().padStart(3)}: ${row.map((v, i) => `[${i}]${v}`).filter((s) => s.length > 4).join(" | ")}`);
  // 메모도 따로
  const notes = cells
    .map((c, i) => (c?.note ? `[${i}]${c.note.replace(/\s+/g, " ")}` : null))
    .filter(Boolean);
  if (notes.length) console.log(`      메모: ${notes.join(" ‖ ")}`);
}
