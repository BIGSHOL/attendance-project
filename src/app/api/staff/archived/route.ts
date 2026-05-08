import { NextResponse } from "next/server";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/apiAuth";
import type { Teacher } from "@/types";

/**
 * GET /api/staff/archived
 * Firebase staff 컬렉션에서 비활성(status !== "active") 스태프 조회 (관리자 전용).
 *
 * 보관함(/admin/archive) 에서 퇴사한 선생님의 과거 출석 데이터를 read-only 로
 * 조회하기 위한 endpoint. Supabase attendance.teacher_id 는 단순 text 라
 * Firebase staff doc 변경/삭제와 무관하게 데이터가 보존되어 있음.
 *
 * Firestore "!=" 쿼리는 null/undefined 를 포함하지 않고 composite index 를
 * 요구하므로, 전체 fetch 후 client-side filter (staff 수가 수십 명 → 부담 없음).
 */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  try {
    const snap = await getDocs(collection(db, "staff"));
    const archived: Teacher[] = snap.docs
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<Teacher, "id">),
      }))
      .filter((s) => s.status !== "active")
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "ko"));
    return NextResponse.json(archived);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 }
    );
  }
}
