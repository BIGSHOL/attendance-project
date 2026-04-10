import { JWT } from "google-auth-library";

/**
 * 서비스 계정으로 Google Sheets API 호출
 * 환경변수 GOOGLE_SERVICE_ACCOUNT_JSON에 서비스 계정 JSON 전체를 문자열로 저장
 */

let cachedClient: JWT | null = null;

function getServiceAccountClient(): JWT {
  if (cachedClient) return cachedClient;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_JSON 환경변수가 설정되지 않았습니다. .env.local에 서비스 계정 JSON을 추가해주세요."
    );
  }

  let credentials: { client_email: string; private_key: string };
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON 파싱 실패 — 유효한 JSON이어야 합니다.");
  }

  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("서비스 계정 JSON에 client_email 또는 private_key가 없습니다.");
  }

  // \n 이스케이프 문자를 실제 개행 문자로 변환 (env 저장 시 한 줄로 넣는 경우)
  const privateKey = credentials.private_key.replace(/\\n/g, "\n");

  cachedClient = new JWT({
    email: credentials.client_email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return cachedClient;
}

export async function getServiceAccountEmail(): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return parsed.client_email || "";
  } catch {
    return "";
  }
}

/**
 * 스프레드시트 메타 조회 (시트 목록)
 */
export async function getSheetMetadata(spreadsheetId: string) {
  const client = getServiceAccountClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("서비스 계정 토큰 발급 실패");

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
 * 지정 범위의 셀 값 조회
 */
export async function getSheetValues(
  spreadsheetId: string,
  range: string
): Promise<(string | number)[][]> {
  const client = getServiceAccountClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("서비스 계정 토큰 발급 실패");

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
