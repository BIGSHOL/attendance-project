import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import type { Consultation, ConsultationCategory } from "@/types";

/**
 * GET /api/sheets/consultations?teacher=...&month=YYYY-MM&key=...
 *
 * Google Sheets `IMPORTDATA()` 전용 공개 엔드포인트 (CSV 반환).
 * 로그인 없이 접근 가능 — 반드시 `SHEETS_API_KEY` 환경변수로 보호.
 *
 * 응답 컬럼: 성명 | 상담 | 상담내용
 *   - 상담: 날짜 목록 (괄호+한글 요일 포맷 → Sheets 가 날짜로 자동 파싱 못함)
 *   - 상담내용: 회차별 [날짜 태그] 제목 + 본문, 회차 간 빈 줄 구분
 *
 * 예:
 *   성명,상담,상담내용
 *   김소은,03/23(월),"[03/23(월) 학생·학업] 성적 하락 상담
 *   지난 달 대비 10점 하락..."
 *   박지율,"04/14(화), 04/18(토)","[04/14(화) 학부모·고민] ...
 *
 * 수식:
 *   H6 = VLOOKUP(B6, IMPORTDATA(...), 2, FALSE)  // 날짜
 *   I6 = VLOOKUP(B6, IMPORTDATA(...), 3, FALSE)  // 내용 (같은 URL → 캐시 공유)
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
  const format = (searchParams.get("format") ?? "csv").trim(); // "csv" | "json" — 디버그용

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

    // 교사 필터링한 raw docs (format=json 디버그용)
    const rawMatched: Array<Record<string, unknown>> = [];
    // studentName → 회차별 entry 목록 (원본 date 로 정렬 후 포맷팅)
    const byStudent = new Map<string, Entry[]>();
    for (const doc of snap.docs) {
      const c = doc.data() as Omit<Consultation, "id">;
      if (!matchesTeacherByAliases(c.consultantName, teacherAliasesLower)) continue;
      rawMatched.push({ id: doc.id, ...c });
      const mmddWeekday = toMMDD(c.date);
      if (!mmddWeekday) continue;
      const list = byStudent.get(c.studentName) ?? [];
      list.push({
        date: c.date,
        mmddWeekday,
        type: c.type,
        category: c.category,
        title: c.title ?? "",
        content: c.content ?? "",
      });
      byStudent.set(c.studentName, list);
    }

    if (format === "json") {
      return NextResponse.json(
        { count: rawMatched.length, docs: rawMatched },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const rows: string[] = ["성명,상담,상담내용"];
    const students = Array.from(byStudent.keys()).sort((a, b) =>
      a.localeCompare(b, "ko")
    );
    for (const name of students) {
      const entries = byStudent.get(name)!.sort((a, b) => a.date.localeCompare(b.date));
      const dateCol = entries.map((e) => e.mmddWeekday).join(", ");
      const detailCol = entries.map(formatEntry).join("\n\n");
      rows.push(
        `${csvEscape(name)},${csvEscape(dateCol)},${csvEscape(detailCol)}`
      );
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

const KOR_WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"] as const;

/**
 * "2026-03-24" → "03/24(화)"
 *   괄호+한글 요일을 포함시키면 Google Sheets IMPORTDATA 가 셀을 날짜로
 *   자동 파싱하지 못해 원본 텍스트 그대로 표시됨 (단일 날짜 셀도 안전).
 *   쉼표 조인된 다중 날짜는 이미 텍스트로 인식되므로 동일 포맷 유지.
 */
function toMMDD(date: string | undefined): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, mm, dd] = date.split("-");
  // UTC 로 고정해 서버 타임존 영향 제거 (KST·UTC 모두 동일한 요일 반환)
  const w = new Date(`${y}-${mm}-${dd}T00:00:00Z`).getUTCDay();
  return `${mm}/${dd}(${KOR_WEEKDAY[w]})`;
}

/** RFC 4180 최소 이스케이프 — 콤마/따옴표/개행 포함 시 큰따옴표로 감싸고 내부 따옴표는 "" */
function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

interface Entry {
  date: string;            // YYYY-MM-DD (정렬용)
  mmddWeekday: string;     // "03/24(화)"
  type: "parent" | "student";
  category: ConsultationCategory;
  title: string;
  content: string;
}

/** ConsultationDetailModal 의 CATEGORY_LABEL 와 동일 */
const CATEGORY_LABEL: Record<ConsultationCategory, string> = {
  academic: "학업",
  behavior: "생활/태도",
  attendance: "출결",
  progress: "진도",
  concern: "고민",
  compliment: "칭찬",
  complaint: "불만",
  general: "일반",
  other: "기타",
};

/**
 * 회차 1건을 셀 표시용 문자열로 변환.
 *   "[03/24(화) 학부모·학업] 제목 텍스트
 *    본문 내용..."
 */
function formatEntry(e: Entry): string {
  const who = e.type === "parent" ? "학부모" : "학생";
  const cat = CATEGORY_LABEL[e.category] ?? e.category;
  const header = `[${e.mmddWeekday} ${who}·${cat}]`;
  const titlePart = e.title ? ` ${e.title}` : "";
  const firstLine = `${header}${titlePart}`;
  return e.content ? `${firstLine}\n${e.content}` : firstLine;
}
