import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSheetMetadata, getSheetValues, getServiceAccountEmail } from "@/lib/googleSheetsClient";

/**
 * Google Sheets URL → 2D 배열로 변환
 * 방식: 서비스 계정으로 Google Sheets API 호출
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // 관리자 권한 체크
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("email", user.email)
    .single();
  if (!role || !["master", "admin"].includes(role.role)) {
    return NextResponse.json({ error: "권한 부족" }, { status: 403 });
  }

  const { url } = await request.json();
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL이 필요합니다" }, { status: 400 });
  }

  // 스프레드시트 ID 추출
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    return NextResponse.json({ error: "유효한 Google Sheets URL이 아닙니다" }, { status: 400 });
  }
  const spreadsheetId = idMatch[1];

  try {
    // 1. 메타데이터 조회 (시트 목록 + gid 매칭)
    const meta = await getSheetMetadata(spreadsheetId);
    const sheets = meta.sheets || [];
    if (sheets.length === 0) {
      return NextResponse.json({ error: "시트를 찾을 수 없습니다" }, { status: 400 });
    }

    // gid 파라미터로 시트 찾기 (없으면 첫 번째)
    const gidMatch = url.match(/[#&?]gid=(\d+)/);
    let targetSheetName: string;
    if (gidMatch) {
      const gid = parseInt(gidMatch[1]);
      const found = sheets.find(
        (s: { properties: { sheetId: number; title: string } }) => s.properties.sheetId === gid
      );
      targetSheetName = found?.properties.title || sheets[0].properties.title;
    } else {
      targetSheetName = sheets[0].properties.title;
    }

    // 2. 셀 값 조회
    const values = await getSheetValues(spreadsheetId, `${targetSheetName}!A1:AZ500`);

    return NextResponse.json({ values, sheetName: targetSheetName });
  } catch (e) {
    const msg = (e as Error).message;
    // 권한 오류 메시지 개선
    if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
      const serviceEmail = await getServiceAccountEmail();
      return NextResponse.json(
        {
          error: `시트 접근 권한이 없습니다. 시트의 "공유" 설정에서 서비스 계정 이메일을 뷰어로 추가해주세요: ${serviceEmail}`,
        },
        { status: 403 }
      );
    }
    if (msg.includes("404")) {
      return NextResponse.json(
        { error: "스프레드시트를 찾을 수 없습니다. URL을 확인해주세요." },
        { status: 404 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
