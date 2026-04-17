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

      // rowKey = `${studentId}|${className}`. className 은 시트 C열 요일 정렬키("화,금").
      // 학생의 해당 시트 행(= 분반)별로 독립 저장. 김지홍 등 분반 2+ 학생 대응.
      const records: Record<string, Record<string, number>> = {};
      const memos: Record<string, Record<string, string>> = {};
      // 시트에만 있는 학생(Firebase 미등록) — virtual_students 에 upsert 할 목록
      const virtualToUpsert: Record<
        string,
        {
          id: string;
          name: string;
          school: string;
          grade: string;
          teacher_staff_id: string;
          class_name: string;
          days: string[];
          subject: string;
        }
      > = {};

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
        // 시트 우선 원칙:
        //  1) Firebase 에 없음 → virtual 학생으로 등록
        //  2) Firebase 에 있지만 이 선생님 담당이 아님 (시트에만 담당으로 기재)
        //     → virtual 학생으로 등록 (원본 Firebase 학생은 그대로 두고 별도 가상 학생 추가)
        const isThisTeacher = !!match?.enrollments?.some(
          (e) => e.teacher === teacherName || e.staffId === teacherName
        );
        if (!match || !isThisTeacher) {
          const virtualId = `virtual_${entry.studentName}_${entrySchool || "unknown"}_${entry.grade || "unknown"}`;
          virtualToUpsert[virtualId] = {
            id: virtualId,
            name: entry.studentName,
            school: entrySchool,
            grade: entry.grade,
            teacher_staff_id: teacherName,
            class_name: entry.tierName || "",
            days: entry.days || [],
            subject: "math",
          };
          match = {
            id: virtualId,
            name: entry.studentName,
            school: entrySchool,
            grade: entry.grade,
          } as Student;
        }
        monthResult.matched++;
        // 시트 F열 tier(entry.tierName)를 class_name 으로 사용해 분반별 독립 저장.
        // 요일 기반 키는 실제 출석 요일과 어긋날 수 있어 포기 — tier 는 시트에서
        // 사용자가 직접 지정한 확정 분반 식별자이므로 가장 안정적.
        //
        // 규칙 (사용자 확정):
        //   - 같은 tierName (= 같은 단가) 여러 행 → 같은 rowKey 로 병합.
        //     날짜 충돌 시 출석 시수를 **덧셈**으로 합산.
        //     예) 윤현소 R31(중등 3T 월목 1.0) + R32(중등 3T 토일 0.5) →
        //         같은 날짜에 1.5 로 기록 → 12.0T 합산
        //   - 다른 tierName (= 다른 단가) → rowKey 분리되어 독립 행 유지
        const className = (entry.tierName || "").trim();
        const rowKey = className ? `${match.id}|${className}` : match.id;
        const existingAtt = records[rowKey] || {};
        const mergedAtt: Record<string, number> = { ...existingAtt };
        for (const [date, hours] of Object.entries(entry.attendance)) {
          mergedAtt[date] = (mergedAtt[date] || 0) + hours;
        }
        records[rowKey] = mergedAtt;
        if (entry.memos && Object.keys(entry.memos).length > 0) {
          const existingMemo = memos[rowKey] || {};
          const mergedMemo: Record<string, string> = { ...existingMemo };
          for (const [date, memo] of Object.entries(entry.memos)) {
            if (!mergedMemo[date]) mergedMemo[date] = memo;
            else if (mergedMemo[date] !== memo) {
              // 같은 날짜에 다른 메모 여러 개면 구분자로 연결
              mergedMemo[date] = mergedMemo[date] + " | " + memo;
            }
            // 같은 메모면 무시 (이전에 발견한 중복 저장 방지)
          }
          memos[rowKey] = mergedMemo;
          monthResult.memoCount += Object.keys(entry.memos).length;
        }

        // F열 tier → SalaryConfig.items[].name 정확 매칭.
        // class_name / rowKey 는 tierName 기반 (attendance 테이블과 통일).
        // 이렇게 해야 studentRows.id (`${studentId}|${tierName}`) 와 tier_overrides 의
        // `(student_id, class_name)` 이 같은 키로 일치해 matchSalarySetting 이 tier 를 찾음.
        if (salaryConfig && entry.tierName) {
          const item = salaryConfig.items.find((i) => i.name === entry.tierName);
          if (item) {
            const key = `${match.id}|${entry.tierName}`;
            tierOverrides[key] = {
              student_id: match.id,
              salary_item_id: item.id,
              tier_name: entry.tierName,
              class_name: entry.tierName,
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

      // 2-a. 시트에만 있는 학생(virtual) upsert — attendance 저장 전에 선행.
      const virtualList = Object.values(virtualToUpsert);
      if (virtualList.length > 0) {
        try {
          const vres = await fetch("/api/virtual-students", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ students: virtualList }),
          });
          if (!vres.ok) {
            const err = await vres.json().catch(() => ({}));
            console.warn("[sync] virtual_students 저장 실패:", err.error);
          } else {
            console.log(
              `[sync] ${tab.sheetName} virtual_students upsert: ${virtualList.length}건 ` +
                `(${virtualList.map((v) => v.name).join(", ")})`
            );
          }
        } catch (e) {
          console.warn("[sync] virtual_students 저장 중 오류:", (e as Error).message);
        }
      }

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
