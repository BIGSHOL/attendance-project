import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getSheetMetadata,
  getSheetValuesWithNotes,
  getServiceAccountEmail,
} from "@/lib/googleSheetsClient";

interface SyncFetchBody {
  sheetUrl: string;
  minMonth?: string;   // "YYYY-MM", 이 월 이전은 스킵 (기본 "2026-03")
  exactMonth?: string; // "YYYY-MM", 지정 시 이 월 단일 탭만 반환 (minMonth 무시)
}

/**
 * 시트의 모든 탭을 스캔해서 월별 탭(`yy.mm`)의 값+메모를 반환
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
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

  const body = (await request.json()) as SyncFetchBody;
  const { sheetUrl, minMonth = "2026-03", exactMonth } = body;

  if (!sheetUrl) {
    return NextResponse.json({ error: "sheetUrl 필요" }, { status: 400 });
  }

  const idMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) {
    return NextResponse.json({ error: "유효한 Google Sheets URL이 아닙니다" }, { status: 400 });
  }
  const spreadsheetId = idMatch[1];

  try {
    // 1. 모든 탭 메타데이터
    const meta = await getSheetMetadata(spreadsheetId);
    const sheets = (meta.sheets || []) as { properties: { title: string; sheetId: number } }[];

    // 2. 월 형식 탭만 필터링
    // exactMonth 지정 시: 해당 월 탭만 동기화
    // 미지정 시: minMonth 이후의 모든 월별 탭 동기화
    const tabPattern = /^(\d{2})\.(\d{1,2})$/;
    const validTabs: { title: string; year: number; month: number; ym: string }[] = [];

    for (const s of sheets) {
      const title = s.properties.title.trim();
      const m = title.match(tabPattern);
      if (!m) continue;
      const year = 2000 + parseInt(m[1]);
      const month = parseInt(m[2]);
      const ym = `${year}-${String(month).padStart(2, "0")}`;
      if (exactMonth) {
        if (ym !== exactMonth) continue;
      } else {
        if (ym < minMonth) continue;
      }
      validTabs.push({ title, year, month, ym });
    }

    // 3. 각 탭마다 값+메모 가져오기 (순차, rate limit 주의)
    const results: {
      sheetName: string;
      year: number;
      month: number;
      values: (string | number)[][];
      notes: (string | undefined)[][];
    }[] = [];

    for (const tab of validTabs) {
      try {
        const { values, notes } = await getSheetValuesWithNotes(
          spreadsheetId,
          `${tab.title}!A1:AZ500`
        );
        results.push({
          sheetName: tab.title,
          year: tab.year,
          month: tab.month,
          values,
          notes,
        });
      } catch (e) {
        console.error(`[sync-fetch] ${tab.title} 조회 실패:`, (e as Error).message);
      }
    }

    return NextResponse.json({ tabs: results });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
      const serviceEmail = await getServiceAccountEmail();
      return NextResponse.json(
        {
          error: `시트 접근 권한이 없습니다. 시트의 "공유" 설정에서 서비스 계정 이메일을 뷰어로 추가해주세요: ${serviceEmail}`,
        },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
