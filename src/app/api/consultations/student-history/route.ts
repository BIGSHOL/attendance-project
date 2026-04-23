import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import type { Consultation } from "@/types";

/**
 * GET /api/consultations/student-history?studentId=X&beforeMonth=YYYY-MM&limit=10
 *   특정 학생의 "과거 월" 상담 이력. beforeMonth 이전 (해당 월 1일 미만) 만 반환.
 *   - 기본 limit 10, 최대 50
 *   - 최신순 정렬
 *   - V2 상담 모달의 "이전 월 이력" 섹션용 (Phase 6)
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const studentId = searchParams.get("studentId");
  const beforeMonth = searchParams.get("beforeMonth"); // YYYY-MM — 이 월의 1일 미만만 반환
  const rawLimit = searchParams.get("limit");
  const limit = Math.min(
    50,
    Math.max(1, rawLimit ? parseInt(rawLimit, 10) || 10 : 10)
  );

  if (!studentId) {
    return NextResponse.json(
      { error: "studentId 파라미터 필수" },
      { status: 400 }
    );
  }
  if (!beforeMonth || !/^\d{4}-\d{2}$/.test(beforeMonth)) {
    return NextResponse.json(
      { error: "beforeMonth 파라미터는 YYYY-MM 형식" },
      { status: 400 }
    );
  }

  try {
    const beforeDate = `${beforeMonth}-01`;
    const db = getAdminDb();
    // 주의: Firestore 복합 인덱스를 요구하지 않도록 studentId 단일 where 만
    // 사용하고 날짜 필터·정렬·limit 는 메모리에서 처리. 한 학생의 총 상담
    // 건수는 보통 수십 건 이하라 메모리 처리 비용이 미미함.
    const snap = await db
      .collection("student_consultations")
      .where("studentId", "==", studentId)
      .get();

    const all: Consultation[] = snap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Consultation, "id">),
    }));
    const filtered = all
      .filter((c) => typeof c.date === "string" && c.date < beforeDate)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);
    return NextResponse.json(filtered);
  } catch (e) {
    console.error("[GET /api/consultations/student-history]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 }
    );
  }
}
