import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Consultation } from "@/types";

/**
 * GET /api/sheets/consultations?teacher=...&month=YYYY-MM&key=...
 *
 * Google Sheets `IMPORTDATA()` 전용 공개 엔드포인트 (CSV 반환).
 * 로그인 없이 접근 가능 — 반드시 `SHEETS_API_KEY` 환경변수로 보호.
 *
 * 응답:
 *   성명,상담
 *   김소은,03/23
 *   박지율,"04/14, 04/18"
 *
 * 수식 예:
 *   =IFERROR(VLOOKUP(B6,
 *     IMPORTDATA("https://attendance-project-snowy.vercel.app/api/sheets/consultations?teacher="
 *                &A$2&"&month=20"&SUBSTITUTE(B$1,".","-")&"&key=..."),
 *     2, FALSE), "")
 */
export async function GET(req: NextRequest) {
  const expectedKey = process.env.SHEETS_API_KEY;
  if (!expectedKey) {
    return NextResponse.json(
      { error: "SHEETS_API_KEY 미설정" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(req.url);
  const key = searchParams.get("key");
  if (key !== expectedKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const teacher = (searchParams.get("teacher") ?? "").trim();
  const month = (searchParams.get("month") ?? "").trim();

  if (!teacher) {
    return NextResponse.json({ error: "teacher 필수" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "month는 YYYY-MM 형식" },
      { status: 400 }
    );
  }

  try {
    const [year, m] = month.split("-").map(Number);
    const start = `${month}-01`;
    const lastDay = new Date(year, m, 0).getDate();
    const end = `${month}-${String(lastDay).padStart(2, "0")}`;

    const db = getAdminDb();
    const snap = await db
      .collection("student_consultations")
      .where("date", ">=", start)
      .where("date", "<=", end)
      .orderBy("date", "asc")
      .get();

    const teacherAliasesLower = new Set(
      extractNameAliases(teacher).map((n) => n.toLowerCase())
    );

    // studentName → sorted MM/DD 목록
    const byStudent = new Map<string, string[]>();
    for (const doc of snap.docs) {
      const c = doc.data() as Omit<Consultation, "id">;
      if (!matchesTeacherByAliases(c.consultantName, teacherAliasesLower)) continue;
      const mmdd = toMMDD(c.date);
      if (!mmdd) continue;
      const list = byStudent.get(c.studentName) ?? [];
      list.push(mmdd);
      byStudent.set(c.studentName, list);
    }

    const rows: string[] = ["성명,상담"];
    const students = Array.from(byStudent.keys()).sort((a, b) =>
      a.localeCompare(b, "ko")
    );
    for (const name of students) {
      const dates = byStudent.get(name)!.sort(); // MM/DD 오름차순
      rows.push(`${csvEscape(name)},${csvEscape(dates.join(", "))}`);
    }
    const csv = rows.join("\n");

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        // Sheets IMPORTDATA는 자체 캐싱하지만, CDN에도 5분 캐시 걸어 호출 부담 완화
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    });
  } catch (e) {
    console.error("[GET /api/sheets/consultations]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 }
    );
  }
}

/**
 * "정유진(Yoojin)" → ["정유진(Yoojin)", "정유진", "Yoojin"]
 * ConsultationsPage.tsx 와 동일 로직 — 드리프트 방지 위해 수정 시 두 곳 함께 변경
 */
function extractNameAliases(raw: string): string[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  const result = new Set<string>([s]);
  const m = s.match(/^(.+?)\s*\(\s*(.+?)\s*\)$/);
  if (m) {
    result.add(m[1].trim());
    result.add(m[2].trim());
  }
  const stripped = s.replace(/\s*\([^)]*\)\s*/g, "").trim();
  if (stripped) result.add(stripped);
  return Array.from(result);
}

function matchesTeacherByAliases(
  consultantName: string | undefined,
  teacherAliasesLower: Set<string>
): boolean {
  if (!consultantName) return false;
  for (const alias of extractNameAliases(consultantName)) {
    if (teacherAliasesLower.has(alias.toLowerCase())) return true;
  }
  return false;
}

function toMMDD(date: string | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [, mm, dd] = date.split("-");
  return `${mm}/${dd}`;
}

/** RFC 4180 최소 이스케이프 — 콤마/따옴표/개행 포함 시 큰따옴표로 감싸고 내부 따옴표는 "" */
function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
