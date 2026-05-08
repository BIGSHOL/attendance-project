import { NextResponse } from "next/server";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import type { Teacher } from "@/types";

// 5분 동안 같은 응답 재사용 (audit v5 #1).
//   Firebase getDocs 1.5초+ 가 자주 호출되어 초기 페이지 로드 병목.
//   staff 변경 빈도 낮음 — 5분 stale 허용.
export const revalidate = 300;

/**
 * GET /api/staff
 * Firebase staff 컬렉션에서 활성(active) 스태프 전체 조회 (ijw-calander 공유)
 *
 * 캐시: 5분 TTL + stale-while-revalidate 10분.
 *   useSalaryConfig hook 의 의존 체인(salary-config + teacher-settings + staff)
 *   에서 가장 느린 endpoint 였으므로 응답 헤더로 CDN/브라우저 양쪽 캐시.
 */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  try {
    const q = query(collection(db, "staff"), where("status", "==", "active"));
    const snap = await getDocs(q);
    const staff: Teacher[] = snap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Teacher, "id">),
    }));
    return NextResponse.json(staff, {
      headers: {
        "Cache-Control":
          "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 }
    );
  }
}
