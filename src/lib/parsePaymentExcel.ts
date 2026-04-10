import * as XLSX from "xlsx";

export interface PaymentRow {
  student_code: string;
  student_name: string;
  grade: string;
  school: string;
  billing_month: string;
  payment_name: string;
  charge_amount: number;
  discount_amount: number;
  paid_amount: number;
  unpaid_amount: number;
  payment_method: string;
  payment_date: string;
  teacher_name: string;
  memo: string;
}

/**
 * 엑셀 파일 버퍼를 파싱하여 수납 데이터 배열로 반환
 * - "교재" 포함 행 제거
 * - 동일 건(이름+학년+학교+수납명+담임강사) 병합 (금액 합산, 메모 병합)
 */
export function parsePaymentExcel(buffer: ArrayBuffer): PaymentRow[] {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws);

  // 1. 교재 행 제거 & 기본 매핑
  const rows: PaymentRow[] = [];
  for (const r of raw) {
    const paymentName = String(r["수납명"] || "");
    if (paymentName.includes("교재")) continue;

    rows.push({
      student_code: String(r["원생고유번호"] || ""),
      student_name: String(r["이름"] || ""),
      grade: String(r["학년"] || ""),
      school: String(r["학교"] || ""),
      billing_month: String(r["청구월"] || ""),
      payment_name: paymentName,
      charge_amount: Number(r["청구액"]) || 0,
      discount_amount: Number(r["할인액"]) || 0,
      paid_amount: Number(r["실제낸금액"]) || 0,
      unpaid_amount: Number(r["미납금액"]) || 0,
      payment_method: String(r["결제수단"] || ""),
      payment_date: String(r["수납일"] || ""),
      teacher_name: String(r["담임강사"] || ""),
      memo: String(r["메모"] || ""),
    });
  }

  // 2. 동일 건 병합
  const mergeMap = new Map<string, PaymentRow>();

  for (const row of rows) {
    const key = [
      row.student_name,
      row.grade,
      row.school,
      row.payment_name,
      row.teacher_name,
    ].join("||");

    const existing = mergeMap.get(key);
    if (!existing) {
      mergeMap.set(key, { ...row });
    } else {
      existing.charge_amount += row.charge_amount;
      existing.discount_amount += row.discount_amount;
      existing.paid_amount += row.paid_amount;
      existing.unpaid_amount += row.unpaid_amount;
      if (row.memo && !existing.memo.includes(row.memo)) {
        existing.memo = existing.memo ? `${existing.memo}\n${row.memo}` : row.memo;
      }
    }
  }

  // 3. 이름순 → 청구액 내림차순 정렬
  const result = Array.from(mergeMap.values());
  result.sort((a, b) => {
    const nameCompare = a.student_name.localeCompare(b.student_name, "ko");
    if (nameCompare !== 0) return nameCompare;
    return b.charge_amount - a.charge_amount;
  });

  return result;
}
