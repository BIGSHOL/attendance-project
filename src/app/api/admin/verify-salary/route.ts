import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedUser } from "@/lib/getAuthedUser";
import {
  getSheetMetadata,
  getSheetValuesWithNotes,
} from "@/lib/googleSheetsClient";

/**
 * GET /api/admin/verify-salary
 *
 * 하네스용 엔드포인트 — 한 선생님의 시트 YY.MM 탭을 읽어 "시트 기대값" 을 구조화.
 *
 * 쿼리:
 *   sheet_url   : Google Sheets URL (or sheet id)
 *   month       : "YYYY-MM"
 *
 * 반환 (sheet side only — UI side 는 호출자가 DB/UI 에서 별도 수집):
 *   - sheetTotal         : R3[25] "보수" 총액 (수학 시트는 비어있을 수 있음)
 *   - studentCount       : 실제 학생 행 수
 *   - perStudent         : [{ name, school, grade, tier, units, unitPrice, charge, paid, salaryBase, salary }]
 *
 * 권한: 관리자/마스터 전용.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const user = await getAuthedUser(supabase);
  if (!user) return NextResponse.json({ error: "인증 필요" }, { status: 401 });

  const { data: role } = await supabase
    .from("user_roles")
    .select("role")
    .eq("email", user.email)
    .single();
  if (!role || !["master", "admin"].includes(role.role)) {
    return NextResponse.json({ error: "권한 부족" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const sheetUrl = searchParams.get("sheet_url") || "";
  const month = searchParams.get("month") || "";

  if (!sheetUrl || !month) {
    return NextResponse.json(
      { error: "sheet_url, month 필수" },
      { status: 400 }
    );
  }
  const mM = month.match(/^(\d{4})-(\d{2})$/);
  if (!mM) {
    return NextResponse.json({ error: "month 포맷은 YYYY-MM" }, { status: 400 });
  }
  const yy = mM[1].slice(2);
  const mNum = parseInt(mM[2]);

  const idMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const spreadsheetId = idMatch ? idMatch[1] : sheetUrl;

  try {
    // 1. 메타 — 탭 제목 확인. "26.3" / "26.03" 둘 다 허용.
    const meta = await getSheetMetadata(spreadsheetId);
    const sheets = (meta.sheets || []) as { properties: { title: string } }[];
    const tabPattern = /^(\d{2})\.(\d{1,2})$/;
    const match = sheets.find((s) => {
      const t = s.properties.title.trim();
      const m = t.match(tabPattern);
      if (!m) return false;
      return m[1] === yy && parseInt(m[2]) === mNum;
    });
    if (!match) {
      return NextResponse.json(
        { error: `'${yy}.${mNum}' 탭 없음`, availableTabs: sheets.map((s) => s.properties.title) },
        { status: 404 }
      );
    }

    // 2. 값 가져오기 (1~500행)
    const { values } = await getSheetValuesWithNotes(
      spreadsheetId,
      `${match.properties.title}!A1:AZ500`
    );

    // 3. R3[25] 보수 파싱 — 영어 시트: "4,954,485 원", 수학 시트는 공란일 수 있음
    const numFromCell = (v: unknown): number | undefined => {
      if (v === undefined || v === null || v === "") return undefined;
      const s = String(v).replace(/[^\d.-]/g, "");
      if (!s) return undefined;
      const n = parseFloat(s);
      return isNaN(n) ? undefined : n;
    };
    const sheetTotalCell = values[2]?.[25];
    const sheetTotal = numFromCell(sheetTotalCell) ?? null;

    // 3-a. 담임명 (R2[0]) — 예: "추민아(Jane)", "김화영"
    const teacherName = String(values[1]?.[0] || "").trim() || null;

    // 3-b. tier 요율 (R3[17~21] 초·중·고·수능·특강) — 영어 시트에 있음
    const tierRatios = {
      초등: numFromCell(values[2]?.[17]) ?? null,
      중등: numFromCell(values[2]?.[18]) ?? null,
      고등: numFromCell(values[2]?.[19]) ?? null,
      수능: numFromCell(values[2]?.[20]) ?? null,
      특강: numFromCell(values[2]?.[21]) ?? null,
    };

    // 4. 학생 행 파싱 — 6행부터 (인덱스 5).
    //    B열(1)=이름, D열(3)=학교, E열(4)=학년, F열(5)=tier,
    //    J열(9)=유닛단가, K열(10)=발행예정, L열(11)=납입, M열(12)=급여정산용,
    //    N열(13)=실급여, O열(14)=등록차수, P열(15)=수업차수
    const FOOTER_MARKERS = new Set(["퇴원생", "신규생", "반이동"]);
    const perStudent: Array<{
      rowIndex: number;
      name: string;
      school: string;
      grade: string;
      tier: string;
      units: number | null;
      unitPrice: number | null;
      charge: number | null;
      paid: number | null;
      salaryBase: number | null;
      salary: number | null;
    }> = [];

    for (let r = 5; r < values.length; r++) {
      const row = values[r] || [];
      const firstCol = String(row[0] || "").trim();
      const secondCol = String(row[1] || "").trim();
      if (FOOTER_MARKERS.has(firstCol) || FOOTER_MARKERS.has(secondCol)) break;
      const name = secondCol;
      if (!name) continue;
      if (/^\d+(\.\d+)?$/.test(name)) continue;
      const school = String(row[3] || "").trim();
      const grade = String(row[4] || "").trim();
      const tier = String(row[5] || "").trim();
      if (!school && !grade) continue;

      perStudent.push({
        rowIndex: r + 1,
        name,
        school,
        grade,
        tier,
        units: numFromCell(row[14]) ?? null,
        unitPrice: numFromCell(row[9]) ?? null,
        charge: numFromCell(row[10]) ?? null,
        paid: numFromCell(row[11]) ?? null,
        salaryBase: numFromCell(row[12]) ?? null,
        salary: numFromCell(row[13]) ?? null,
      });
    }

    // 5. 학생 합산으로 보수 재계산 (R3 비어있는 시트 대응)
    const computedTotal = perStudent.reduce(
      (s, p) => s + (p.salary ?? 0),
      0
    );

    return NextResponse.json({
      month,
      tabTitle: match.properties.title,
      teacherName,
      tierRatios,
      sheetTotal,
      computedTotal, // 학생별 실급여 합 — R3 결측 시 fallback
      studentCount: perStudent.length,
      perStudent,
    });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
