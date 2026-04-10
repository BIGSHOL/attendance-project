import { NextResponse } from "next/server";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import type { Teacher } from "@/types";

/**
 * GET /api/staff
 * Firebase staff 컬렉션에서 활성(active) 스태프 전체 조회 (ijw-calander 공유)
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
    return NextResponse.json(staff);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 }
    );
  }
}
