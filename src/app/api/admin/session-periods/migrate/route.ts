import { NextResponse } from "next/server";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/apiAuth";
import { mergeOverlappingRanges } from "@/lib/sessionUtils";
import type { SessionPeriod } from "@/types";

// Firestore → Supabase 과목 매핑
// ijw-calander의 eie(English Intensive Education)는 이 프로젝트에서 english 에 합침
const CATEGORY_MAP: Record<string, string> = {
  eie: "english",
};

/**
 * POST /api/admin/session-periods/migrate
 * Firestore session_periods → Supabase 일회성 복사 (관리자 이상)
 */
export async function POST() {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  try {
    const snap = await getDocs(collection(db, "session_periods"));

    // 1. 원본 → 매핑 적용한 목록 (id는 매핑된 카테고리로 재생성)
    const mapped: SessionPeriod[] = snap.docs.map((d) => {
      const data = d.data() as Omit<SessionPeriod, "id">;
      const rawCategory = String(data.category);
      const newCategory = CATEGORY_MAP[rawCategory] || rawCategory;
      return {
        id: `${data.year}-${newCategory}-${data.month}`,
        year: Number(data.year),
        category: newCategory,
        month: Number(data.month),
        ranges: data.ranges || [],
        sessions: Number(data.sessions) || 12,
      };
    });

    // 2. 동일 ID 중복 병합
    const mergedMap = new Map<string, SessionPeriod>();
    for (const s of mapped) {
      const existing = mergedMap.get(s.id);
      if (existing) {
        existing.ranges = mergeOverlappingRanges([...existing.ranges, ...s.ranges]);
      } else {
        mergedMap.set(s.id, { ...s, ranges: [...s.ranges] });
      }
    }
    const list = Array.from(mergedMap.values());

    if (list.length === 0) {
      return NextResponse.json({ count: 0, mergedCount: 0, message: "Firestore에 데이터 없음" });
    }

    // 3. Supabase upsert
    const normalized = list.map((r) => ({
      id: r.id,
      year: r.year,
      category: r.category,
      month: r.month,
      ranges: r.ranges,
      sessions: r.sessions,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("session_periods")
      .upsert(normalized, { onConflict: "id" });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      count: list.length,
      mergedCount: snap.docs.length - list.length,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "마이그레이션 실패" },
      { status: 500 }
    );
  }
}
