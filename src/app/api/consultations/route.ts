import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import type { Consultation } from "@/types";

/**
 * GET /api/consultations?month=YYYY-MM
 *   ijw-calander의 `student_consultations` 컬렉션에서 해당 월 상담 전체 조회
 *   - Admin SDK 사용 (Rules 우회, Supabase Auth 기반)
 *   - 읽기 전용. 입력은 ijw-calander가 전담
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const month = searchParams.get("month"); // YYYY-MM

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: "month 파라미터는 YYYY-MM 형식이어야 합니다" },
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
      .orderBy("date", "desc")
      .get();

    const consultations: Consultation[] = snap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Consultation, "id">),
    }));
    return NextResponse.json(consultations);
  } catch (e) {
    console.error("[GET /api/consultations]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 }
    );
  }
}
