import type { Student, SalaryConfig } from "@/types";
import {
  parseAttendanceFromArray,
  normalizeSchoolName,
} from "./parseAttendanceExcel";

export interface MonthSyncResult {
  year: number;
  month: number;
  sheetName: string;
  total: number;
  matched: number;
  unmatched: number;
  memoCount: number;
  /** F열 tier 매칭 성공 수 */
  tierMatched: number;
  /** F열에 값은 있었으나 SalaryConfig 항목과 매칭 실패한 수 */
  tierUnmatched: number;
  error?: string;
}

export interface TeacherSyncResult {
  teacherId: string;
  teacherName: string;
  success: boolean;
  error?: string;
  months: MonthSyncResult[];
}

/**
 * 한 선생님의 시트를 읽어 유효 월 탭을 Supabase로 import
 * @param exactMonth "YYYY-MM" 형식, 지정 시 해당 월 단일 탭만 동기화
 * @param minMonth exactMonth가 없을 때 이 월 이후의 모든 탭을 전체 동기화 (기본 "2026-03")
 */
export async function syncTeacherSheet(
  teacherId: string,
  teacherName: string,
  sheetUrl: string,
  students: Student[],
  minMonth = "2026-03",
  exactMonth?: string,
  /** F열 tier 매칭용 — 있으면 학생 tier 오버라이드를 저장 */
  salaryConfig?: SalaryConfig
): Promise<TeacherSyncResult> {
  const result: TeacherSyncResult = {
    teacherId,
    teacherName,
    success: false,
    months: [],
  };

  // 1. 시트 메타 + 대상 탭 가져오기
  const fetchRes = await fetch("/api/attendance/sync-fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sheetUrl, minMonth, exactMonth }),
  });
  const fetchData = await fetchRes.json();
  if (!fetchRes.ok) {
    result.error = fetchData.error || "시트 조회 실패";
    return result;
  }

  const tabs = fetchData.tabs as {
    sheetName: string;
    year: number;
    month: number;
    values: (string | number)[][];
    notes: (string | undefined)[][];
  }[];

  if (tabs.length === 0) {
    result.success = true;
    result.error = exactMonth
      ? `'${exactMonth}' 월 탭(yy.mm)이 시트에 없습니다`
      : `'${minMonth}' 이후의 월별 탭(yy.mm)이 없습니다`;
    return result;
  }

  // tier 오버라이드 누적 — key: `{studentId}|{daysKey}` (학생 × 분반).
  // 한 학생이 같은 선생님에게 여러 분반(요일 다름) 수업을 받는 경우 분반별로 저장.
  const tierOverrides: Record<
    string,
    {
      student_id: string;
      salary_item_id: string;
      tier_name: string;
      class_name: string;
    }
  > = {};

  // 2. 각 탭별로 파싱 + 매칭 + 저장
  for (const tab of tabs) {
    const monthResult: MonthSyncResult = {
      year: tab.year,
      month: tab.month,
      sheetName: tab.sheetName,
      total: 0,
      matched: 0,
      unmatched: 0,
      memoCount: 0,
      tierMatched: 0,
      tierUnmatched: 0,
    };

    try {
      const parsed = parseAttendanceFromArray(tab.values, tab.notes);
      monthResult.total = parsed.entries.length;

      // 디버그: 파싱 직후 메모 총 개수 확인
      const rawMemoCount = parsed.entries.reduce(
        (sum, e) => sum + Object.keys(e.memos || {}).length,
        0
      );
      console.log(
        `[sync] ${tab.sheetName} 파싱 완료: 학생 ${parsed.entries.length}명, 메모 총 ${rawMemoCount}개 (${parsed.minDate}~${parsed.maxDate})`
      );

      const records: Record<string, Record<string, number>> = {};
      const memos: Record<string, Record<string, string>> = {};

      for (const entry of parsed.entries) {
        const entrySchool = normalizeSchoolName(entry.school || "");
        // 이름 + 학교 정규화 매칭
        let match = students.find(
          (s) =>
            s.name === entry.studentName &&
            (entrySchool ? normalizeSchoolName(s.school || "") === entrySchool : true)
        );
        if (!match) {
          // 이름만 매칭
          match = students.find((s) => s.name === entry.studentName);
        }
        if (!match) {
          monthResult.unmatched++;
          continue;
        }
        monthResult.matched++;
        // 같은 학생이 같은 탭(월)에 여러 분반으로 등장 가능 (예: 김지홍 = 화금 + 목).
        // 덮어쓰기 대신 병합하여 모든 요일의 출석/메모를 보존한다.
        records[match.id] = { ...(records[match.id] || {}), ...entry.attendance };
        if (entry.memos && Object.keys(entry.memos).length > 0) {
          memos[match.id] = { ...(memos[match.id] || {}), ...entry.memos };
          monthResult.memoCount += Object.keys(entry.memos).length;
        }

        // F열 tier → SalaryConfig.items[].name 정확 매칭. 분반(요일)별 저장.
        if (salaryConfig && entry.tierName) {
          const item = salaryConfig.items.find((i) => i.name === entry.tierName);
          if (item) {
            const daysKey = (entry.days || []).slice().sort().join(",");
            const key = `${match.id}|${daysKey}`;
            tierOverrides[key] = {
              student_id: match.id,
              salary_item_id: item.id,
              tier_name: entry.tierName,
              class_name: daysKey,
            };
            monthResult.tierMatched++;
          } else {
            monthResult.tierUnmatched++;
          }
        }
      }

      // 매칭 후 메모 카운트 — 서버에 보낼 실제 메모 개수
      console.log(
        `[sync] ${tab.sheetName} 매칭 완료: 학생 ${monthResult.matched}/${monthResult.total}, ` +
          `매칭된 메모 ${monthResult.memoCount}개, memos 키=${Object.keys(memos).length}명`
      );

      // 3. Import API로 저장 (탭이 커버하는 날짜 범위만 덮어쓰기)
      const importRes = await fetch("/api/attendance/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherId,
          year: tab.year,
          month: tab.month,
          records,
          memos,
          overwrite: true,
          startDate: parsed.minDate || undefined,
          endDate: parsed.maxDate || undefined,
        }),
      });
      if (!importRes.ok) {
        const err = await importRes.json();
        monthResult.error = err.error || "저장 실패";
      }
    } catch (e) {
      monthResult.error = (e as Error).message;
    }

    result.months.push(monthResult);
  }

  // 3. tier 오버라이드 일괄 저장 (배열 형식 — 분반별 분리 지원)
  const overrideList = Object.values(tierOverrides);
  if (overrideList.length > 0) {
    try {
      const tierRes = await fetch("/api/attendance/tier-overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherId, overrides: overrideList }),
      });
      if (!tierRes.ok) {
        const err = await tierRes.json();
        console.warn("[sync] tier 오버라이드 저장 실패:", err.error);
      } else {
        console.log(
          `[sync] tier 오버라이드 저장 완료: ${overrideList.length}건 (분반별 분리 포함)`
        );
      }
    } catch (e) {
      console.warn("[sync] tier 오버라이드 저장 중 오류:", (e as Error).message);
    }
  }

  result.success = true;
  return result;
}
