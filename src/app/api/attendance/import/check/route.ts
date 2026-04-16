import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";
import { getServiceAccountEmail } from "@/lib/googleSheetsClient";
import { JWT } from "google-auth-library";
import { readFileSync } from "fs";

/**
 * 서비스 계정 설정 진단 엔드포인트
 */
export async function GET() {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const diag: Record<string, unknown> = {
    source: null,
    jsonParseable: false,
    clientEmail: null,
    tokenObtained: false,
    error: null,
  };

  let credentials: { client_email: string; private_key: string } | null = null;

  try {
    // 어느 방식으로 로드되었는지 확인
    if (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
      diag.source = "separate fields (EMAIL + PRIVATE_KEY)";
      credentials = {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      };
      diag.jsonParseable = true;
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_PATH) {
      diag.source = `file: ${process.env.GOOGLE_SERVICE_ACCOUNT_PATH}`;
      const content = readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_PATH, "utf-8");
      credentials = JSON.parse(content);
      diag.jsonParseable = true;
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_B64) {
      diag.source = "base64";
      const decoded = Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_B64, "base64").toString(
        "utf-8"
      );
      credentials = JSON.parse(decoded);
      diag.jsonParseable = true;
    } else if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      diag.source = "inline JSON";
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      diag.jsonParseable = true;
    } else {
      diag.error =
        "환경변수 없음 (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY 권장)";
      return NextResponse.json(diag);
    }
  } catch (e) {
    diag.error = `로드/파싱 실패: ${(e as Error).message}`;
    return NextResponse.json(diag);
  }

  if (!credentials) {
    return NextResponse.json(diag);
  }

  diag.clientEmail = credentials.client_email || null;

  // 토큰 발급 시도
  try {
    const client = new JWT({
      email: credentials.client_email,
      key: credentials.private_key.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const { token } = await client.getAccessToken();
    diag.tokenObtained = !!token;
  } catch (e) {
    diag.error = `토큰 발급 실패: ${(e as Error).message}`;
  }

  const serviceEmail = await getServiceAccountEmail();
  diag.serviceAccountEmail = serviceEmail;
  diag.note = "시트를 이 이메일에 뷰어로 공유해야 접근 가능합니다.";

  return NextResponse.json(diag);
}
