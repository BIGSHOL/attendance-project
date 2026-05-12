import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import { getAdminDb } from "@/lib/firebase-admin";
import { extractTeacherFromBillingName } from "@/lib/extractTeacherFromBillingName";
import { normalizeSchool } from "@/lib/studentPaymentMatcher";

/**
 * GET /api/billing?month=2026-04
 *      또는 /api/billing?months=2026-04,2026-03 (CSV)
 *      또는 /api/billing?summary=true                  → 월별 요약 (전체)
 *      또는 /api/billing?summary=true&months=2026-04,...
 *      categories=수업,교재 (CSV) — 기본 "수업,원복" (학원비 만, 정산 호환)
 *      categories=all                                  → 카테고리 필터 해제
 *
 * Firebase Firestore (ijw-calander DB: restore20260319) 의 `billing` collection 을
 * Supabase `payments` 테이블과 동일한 스키마로 변환해서 반환.
 *
 * MakeEdu 가 매일 새벽 3시(KST) 외부 학원관리시스템에서 자동 동기화 — 운영자가
 * 엑셀 업로드 안 해도 항상 최신.
 *
 * 카테고리 기본 필터:
 *   수업/원복 만 반환 — 정산·시수 검증과 호환 (교재·차량비 제외, 엑셀 업로드 동작과 일치).
 *   "교재" 청구는 단가로 나누면 잘못된 시수가 계산되므로 분자에서 제외해야 함.
 *   payments 탭에서 전체를 보려면 ?categories=all 사용.
 *
 * 응답 스키마는 GET /api/payments 와 호환 + 두 가지 추가 필드:
 *   - category : "수업" / "교재" / "차량비" / "원복" (Firebase 원본)
 *   - source   : "firebase" (UI 에서 supabase 와 구분용)
 */

const DEFAULT_CATEGORIES = new Set(["수업", "원복"]);

function parseCategories(raw: string | null): Set<string> | null {
  if (!raw) return DEFAULT_CATEGORIES;
  if (raw === "all") return null; // 필터 해제
  const set = new Set<string>();
  for (const c of raw.split(",").map((s) => s.trim()).filter(Boolean)) set.add(c);
  return set.size > 0 ? set : DEFAULT_CATEGORIES;
}

interface BillingDoc {
  externalStudentId?: string;
  studentName?: string;
  grade?: string;
  school?: string;
  month?: string;
  billingName?: string;
  billedAmount?: number;
  discountAmount?: number;
  paidAmount?: number;
  unpaidAmount?: number;
  paymentMethod?: string;
  paidDate?: string;
  memo?: string;
  category?: string;
}

interface StaffDoc {
  name: string;
  englishName?: string;
  status?: string;
}

async function loadStaff(): Promise<
  Array<{ id: string; name: string; englishName?: string }>
> {
  const adminDb = getAdminDb();
  // active 만 — 퇴사 강사는 매칭 후보에서 제외
  const snap = await adminDb
    .collection("staff")
    .where("status", "==", "active")
    .get();
  return snap.docs.map((d) => {
    const data = d.data() as StaffDoc;
    return {
      id: d.id,
      name: data.name,
      englishName: data.englishName,
    };
  });
}

async function loadBillingForMonths(months: string[]): Promise<
  Array<{ id: string; data: BillingDoc }>
> {
  const adminDb = getAdminDb();
  // Firestore `in` 쿼리는 최대 30 — 우리는 보통 5개월 이하라 안전.
  // 30 초과 시 chunk 처리.
  const chunks: string[][] = [];
  for (let i = 0; i < months.length; i += 30) chunks.push(months.slice(i, i + 30));

  const all: Array<{ id: string; data: BillingDoc }> = [];
  for (const chunk of chunks) {
    const snap = await adminDb
      .collection("billing")
      .where("month", "in", chunk)
      .get();
    for (const d of snap.docs) {
      all.push({ id: d.id, data: d.data() as BillingDoc });
    }
  }
  return all;
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const month = searchParams.get("month");
  const monthsCsv = searchParams.get("months");
  const summary = searchParams.get("summary");
  const categoryFilter = parseCategories(searchParams.get("categories"));

  // ─── 요약 모드 ─────────────────────────────────────
  //   summary=true 만 있으면 전체 billing 의 월별 집계 반환.
  //   month/months 도 있으면 그 범위만 집계.
  //   카테고리 필터 동일 적용.
  if (summary) {
    const adminDb = getAdminDb();
    let monthsList: string[] | null = null;
    if (monthsCsv)
      monthsList = monthsCsv.split(",").map((s) => s.trim()).filter(Boolean);
    else if (month) monthsList = [month];

    let docs: Array<{ data: BillingDoc }>;
    if (monthsList && monthsList.length > 0) {
      const loaded = await loadBillingForMonths(monthsList);
      docs = loaded.map((x) => ({ data: x.data }));
    } else {
      // 전체 — select 로 필요한 필드만 (billingName 도 "교재" 추가 필터용)
      const snap = await adminDb
        .collection("billing")
        .select("month", "billedAmount", "paidAmount", "category", "billingName")
        .get();
      docs = snap.docs.map((d) => ({ data: d.data() as BillingDoc }));
    }

    const monthMap = new Map<
      string,
      { count: number; total_charge: number; total_paid: number }
    >();
    for (const { data } of docs) {
      if (categoryFilter) {
        if (!categoryFilter.has(data.category || "")) continue;
        if ((data.billingName || "").includes("교재")) continue;
      }
      const m = data.month || "";
      const existing = monthMap.get(m) || {
        count: 0,
        total_charge: 0,
        total_paid: 0,
      };
      existing.count += 1;
      existing.total_charge += Number(data.billedAmount) || 0;
      existing.total_paid += Number(data.paidAmount) || 0;
      monthMap.set(m, existing);
    }
    const result = Array.from(monthMap.entries())
      .map(([m, s]) => ({ month: m, ...s }))
      .sort((a, b) => b.month.localeCompare(a.month));
    return NextResponse.json(result);
  }

  // ─── 일반 모드 — 한 월 / 여러 월의 row 반환 ────────
  const monthsList = monthsCsv
    ? monthsCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : month
      ? [month]
      : [];
  if (monthsList.length === 0) {
    return NextResponse.json(
      { error: "month 또는 months 필수" },
      { status: 400 }
    );
  }

  const [staff, billing] = await Promise.all([
    loadStaff(),
    loadBillingForMonths(monthsList),
  ]);

  // category 필터 + billingName "교재" 포함 시 추가 제외.
  //   MakeEdu 일부 교재 청구가 category="수업" 으로 분류돼서 분반 청구와 섞임.
  //   parsePaymentExcel.ts 의 정책과 일관 — 정산·시수 검증에서 교재가 단가로 환산되는
  //   문제 방지. categories=all 호출(수납탭) 시에는 그대로 노출.
  const filtered = categoryFilter
    ? billing.filter(
        ({ data }) =>
          categoryFilter.has(data.category || "") &&
          !(data.billingName || "").includes("교재")
      )
    : billing;

  const result = filtered.map(({ id, data }) => {
    const billingName = data.billingName || "";
    const { staffId, teacherName } = extractTeacherFromBillingName(
      billingName,
      staff
    );
    return {
      id,
      student_code: data.externalStudentId || "",
      student_name: data.studentName || "",
      grade: data.grade || "",
      school: normalizeSchool(data.school || ""),
      billing_month: data.month || "",
      payment_name: billingName,
      charge_amount: Number(data.billedAmount) || 0,
      discount_amount: Number(data.discountAmount) || 0,
      paid_amount: Number(data.paidAmount) || 0,
      unpaid_amount: Number(data.unpaidAmount) || 0,
      payment_method: data.paymentMethod || "",
      payment_date: data.paidDate || "",
      teacher_name: teacherName || "",
      teacher_staff_id: staffId || null,
      memo: data.memo || "",
      category: data.category || "",
      source: "firebase" as const,
    };
  });

  // 정렬 — payments 와 동일하게 (student_name asc, charge_amount desc)
  result.sort((a, b) => {
    const nameCmp = a.student_name.localeCompare(b.student_name, "ko");
    if (nameCmp !== 0) return nameCmp;
    return b.charge_amount - a.charge_amount;
  });

  return NextResponse.json(result);
}
