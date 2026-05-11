import { JWT } from "google-auth-library";
import { readFileSync } from "fs";

/**
 * 서비스 계정으로 Google Sheets API 호출
 *
 * 권장: 개별 필드로 등록 (Vercel 호환, 가장 간단)
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL=attendance-sync@....iam.gserviceaccount.com
 *   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
 *
 * 대체 방법:
 *   GOOGLE_SERVICE_ACCOUNT_PATH — JSON 파일의 절대 경로 (로컬 전용)
 *   GOOGLE_SERVICE_ACCOUNT_B64  — JSON을 base64 인코딩
 *   GOOGLE_SERVICE_ACCOUNT_JSON — JSON 문자열 (이스케이프 주의)
 */

let cachedClient: JWT | null = null;
let cachedCredentials: { client_email: string; private_key: string } | null = null;

function loadCredentials(): { client_email: string; private_key: string } {
  if (cachedCredentials) return cachedCredentials;

  // 1순위: 개별 필드 (EMAIL + PRIVATE_KEY)
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (email && privateKey) {
    const creds = { client_email: email, private_key: privateKey };
    cachedCredentials = creds;
    return creds;
  }

  // 2순위: 파일 경로
  const path = process.env.GOOGLE_SERVICE_ACCOUNT_PATH;
  if (path) {
    try {
      const content = readFileSync(path, "utf-8");
      const parsed = JSON.parse(content);
      cachedCredentials = parsed;
      return parsed;
    } catch (e) {
      throw new Error(
        `GOOGLE_SERVICE_ACCOUNT_PATH 파일 읽기/파싱 실패 (${path}): ${(e as Error).message}`
      );
    }
  }

  // 2순위: Base64 인코딩
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (b64) {
    try {
      const decoded = Buffer.from(b64, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);
      cachedCredentials = parsed;
      return parsed;
    } catch (e) {
      throw new Error(`GOOGLE_SERVICE_ACCOUNT_B64 디코딩/파싱 실패: ${(e as Error).message}`);
    }
  }

  // 3순위: 인라인 JSON 문자열
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      cachedCredentials = parsed;
      return parsed;
    } catch (e) {
      throw new Error(
        `GOOGLE_SERVICE_ACCOUNT_JSON 파싱 실패: ${(e as Error).message}. ` +
          `해결: GOOGLE_SERVICE_ACCOUNT_PATH=절대경로 로 설정하거나, base64 인코딩 후 GOOGLE_SERVICE_ACCOUNT_B64 사용.`
      );
    }
  }

  throw new Error(
    "서비스 계정 설정이 없습니다. .env.local에 GOOGLE_SERVICE_ACCOUNT_PATH (파일 경로) 또는 GOOGLE_SERVICE_ACCOUNT_B64 또는 GOOGLE_SERVICE_ACCOUNT_JSON 중 하나를 추가해주세요."
  );
}

function getServiceAccountClient(): JWT {
  if (cachedClient) return cachedClient;

  const credentials = loadCredentials();

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("서비스 계정 JSON에 client_email 또는 private_key가 없습니다.");
  }

  // \n 이스케이프 문자를 실제 개행 문자로 변환
  const privateKey = credentials.private_key.replace(/\\n/g, "\n");

  cachedClient = new JWT({
    email: credentials.client_email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return cachedClient;
}

/**
 * Access token 캐싱 (audit V7 Phase 1).
 *   기존: getSheetMetadata + getSheetValuesWithNotes 매 호출마다 client.getAccessToken() —
 *         JWT 새로 서명 + Google OAuth endpoint 왕복. 선생님당 N+1 회 누적.
 *   개선: 50분 TTL 메모리 캐시. 만료 1분 buffer.
 *
 *   JWT.getAccessToken() 의 응답에서 expires_at 을 그대로 사용하되, 없으면 50분 보수적 fallback.
 *   발급 실패 시 캐시 invalidate 후 throw.
 *
 *   다중 동시 호출 시 in-flight Promise 공유 (race condition 방지) — 같은 sync 안의 여러 탭이
 *   동시에 token 요청해도 1번만 실제 API 호출.
 */
let cachedToken: { token: string; expiresAt: number } | null = null;
let inflightTokenPromise: Promise<string> | null = null;

async function getCachedAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }
  if (inflightTokenPromise) return inflightTokenPromise;

  inflightTokenPromise = (async () => {
    try {
      const client = getServiceAccountClient();
      const result = await client.getAccessToken();
      const token = result.token;
      if (!token) throw new Error("서비스 계정 토큰 발급 실패");
      // expires_at 가 google-auth-library 응답에 있을 수도 있음 (epoch ms).
      // 없으면 50분 보수적 fallback (실제 1시간 만료 - 10분 buffer).
      const expiresAtRaw = (result.res?.data as { expires_in?: number } | undefined)?.expires_in;
      const expiresAt = expiresAtRaw
        ? Date.now() + expiresAtRaw * 1000
        : Date.now() + 50 * 60_000;
      cachedToken = { token, expiresAt };
      return token;
    } finally {
      inflightTokenPromise = null;
    }
  })();
  return inflightTokenPromise;
}

export async function getServiceAccountEmail(): Promise<string> {
  try {
    const creds = loadCredentials();
    return creds.client_email || "";
  } catch {
    return "";
  }
}

/**
 * 스프레드시트 메타 조회 (시트 목록)
 */
export async function getSheetMetadata(spreadsheetId: string) {
  const token = await getCachedAccessToken();

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties,properties.title`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`메타 조회 실패 (${res.status}): ${errText}`);
  }

  return res.json();
}

/**
 * 지정 범위의 셀 값 + 메모 동시 조회 (includeGridData)
 * @returns { values: string[][], notes: string[][] }
 */
export async function getSheetValuesWithNotes(
  spreadsheetId: string,
  range: string
): Promise<{ values: (string | number)[][]; notes: (string | undefined)[][] }> {
  const token = await getCachedAccessToken();

  // fields 필터 제거 — 응답 크기 증가하더라도 누락 없이 모든 셀(note 포함) 반환
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}` +
    `?ranges=${encodeURIComponent(range)}` +
    `&includeGridData=true`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`값+메모 조회 실패 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const rowData = data.sheets?.[0]?.data?.[0]?.rowData || [];
  const values: (string | number)[][] = [];
  const notes: (string | undefined)[][] = [];

  let noteCount = 0;
  for (let r = 0; r < rowData.length; r++) {
    const cells = rowData[r]?.values || [];
    const valueRow: (string | number)[] = [];
    const noteRow: (string | undefined)[] = [];
    for (let c = 0; c < cells.length; c++) {
      const cell = cells[c];
      if (!cell) continue;
      valueRow[c] = cell.formattedValue ?? "";
      if (cell.note) {
        noteRow[c] = cell.note;
        noteCount++;
      }
    }
    values[r] = valueRow;
    notes[r] = noteRow;
  }

  console.log(
    `[sync] ${range} → 행: ${rowData.length}, 메모 셀: ${noteCount}개`
  );

  return { values, notes };
}

/**
 * 지정 범위의 셀 값 조회
 */
export async function getSheetValues(
  spreadsheetId: string,
  range: string
): Promise<(string | number)[][]> {
  const token = await getCachedAccessToken();

  const encodedRange = encodeURIComponent(range);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueRenderOption=FORMATTED_VALUE`,
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`값 조회 실패 (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.values || [];
}
