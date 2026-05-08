/**
 * 엑셀(.xlsx) 내보내기 유틸 — SheetJS 기반.
 *
 * 사용 패턴 (audit v5 #3 — async API):
 *   const wb = await createWorkbook();
 *   await addSheet(wb, "Sheet1", rows);
 *   await writeFile(wb, "filename.xlsx");
 *
 * 정산·출석부·시수 검증 등 표 형태 export 에 공용으로 사용.
 *
 * xlsx (SheetJS, ~319KB) 는 dynamic import 로 export 핸들러 호출 시점에만
 * 로드 — 초기 페이지 번들에서 제외해 LCP 개선.
 */

// xlsx 타입만 import (런타임 X). 실제 lib 은 동적 import.
import type { WorkBook } from "xlsx";

// 모듈 캐시 — 한 번 로드 후 재사용
let xlsxModule: typeof import("xlsx") | null = null;
async function loadXlsx() {
  if (!xlsxModule) {
    xlsxModule = await import("xlsx");
  }
  return xlsxModule;
}

/** 워크북 생성 (빈) */
export async function createWorkbook(): Promise<WorkBook> {
  const XLSX = await loadXlsx();
  return XLSX.utils.book_new();
}

/**
 * 2D 배열(행 × 열)을 워크북에 새 시트로 추가.
 *   첫 행은 헤더로 사용 — 자동 굵게 처리는 SheetJS Community 에서 미지원.
 *   col widths 는 입력 데이터 길이 기반 자동 계산.
 */
export async function addSheet(
  wb: WorkBook,
  sheetName: string,
  rows: (string | number | null | undefined)[][],
  options?: {
    /** 컬럼 폭 자동 계산 시 최대 폭 (기본 40) */
    maxColWidth?: number;
  }
) {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.aoa_to_sheet(rows);

  // 컬럼 폭 자동
  const maxCol = Math.max(0, ...rows.map((r) => r.length));
  const widths: { wch: number }[] = [];
  for (let c = 0; c < maxCol; c++) {
    let max = 4;
    for (const r of rows) {
      const v = r[c];
      if (v === null || v === undefined) continue;
      const s = String(v);
      // 한글은 2글자 폭으로 가정 (xlsx 폭은 ASCII 기준 단위)
      const w = Array.from(s).reduce(
        (a, ch) => a + (/[ㄱ-ㆎ가-힣]/.test(ch) ? 2 : 1),
        0
      );
      if (w > max) max = w;
    }
    widths.push({ wch: Math.min(max + 2, options?.maxColWidth ?? 40) });
  }
  ws["!cols"] = widths;

  // 시트명: 엑셀 31자 제한 + 특수문자 제거
  const safeName = sheetName.replace(/[\\/?*[\]:]/g, "_").slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, safeName);
}

/**
 * 워크북을 .xlsx 로 다운로드.
 *   브라우저에서만 동작.
 */
export async function writeFile(wb: WorkBook, filename: string) {
  const XLSX = await loadXlsx();
  const safe = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  XLSX.writeFile(wb, safe, { compression: true });
}

/**
 * 한글 숫자 포맷 — 1234567 → "1,234,567"
 *   엑셀 내부에 숫자 그대로 두면 사용자가 직접 포맷 설정 가능하므로
 *   금액 컬럼은 가능하면 number 그대로 export 하는 것을 권장.
 */
export function formatKRW(n: number): string {
  return Math.round(n).toLocaleString("ko-KR");
}
