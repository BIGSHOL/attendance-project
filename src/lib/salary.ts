import type { SalarySettingItem, SalaryConfig, Student, IncentiveConfig, SalarySubject, SalaryGroup } from "@/types";
import type { SalaryType } from "@/hooks/useUserRole";

/**
 * 날짜 문자열(YYYY-MM-DD)을 요일 라벨(일~토)로 변환
 */
export function getDayLabelFromDate(dateStr: string): string {
  const d = new Date(dateStr);
  return ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
}

/**
 * 선생님 급여 유형에 따라 출석이 급여 계산 대상인지 판단
 * - commission (비율제): 모든 출석 반영
 * - fixed (급여제): 반영 안 함
 * - mixed (혼합): commission_days 에 해당하는 요일만 반영
 */
export function isAttendanceCountable(
  dateStr: string,
  salaryType: SalaryType | undefined,
  commissionDays: string[] | undefined
): boolean {
  if (!salaryType || salaryType === "commission") return true;
  if (salaryType === "fixed") return false;
  if (salaryType === "mixed") {
    const dayLabel = getDayLabelFromDate(dateStr);
    return (commissionDays || []).includes(dayLabel);
  }
  return true;
}

/**
 * 유효 수업 단가 반환
 */
export function getEffectiveUnitPrice(item: SalarySettingItem): number {
  return item.unitPrice || item.baseTuition || 0;
}

/**
 * 소수 첫째 자리까지 내림 (e.g. 69691.5 → 69691.5, 69691.56 → 69691.5)
 */
function floor1(n: number): number {
  return Math.floor(n * 10) / 10;
}

/**
 * 과정별 1회 수업료 계산
 * - 고정급: fixedRate 그대로
 * - 비율제: baseTuition × (1 - 수수료/100) × (비율/100)
 * - ratioOverride가 제공되면 해당 비율 사용
 * 반올림 정책: 소수 첫째 자리까지 내림 (학원 손해 방지). 최종 합계는 정수 내림.
 */
export function calculateClassRate(
  item: SalarySettingItem,
  academyFee: number,
  ratioOverride?: number
): number {
  if (item.type === "fixed") {
    return item.fixedRate;
  }
  const netTuition = item.baseTuition * (1 - academyFee / 100);
  const effectiveRatio = typeof ratioOverride === "number" ? ratioOverride : item.ratio;
  return floor1(netTuition * (effectiveRatio / 100));
}

/**
 * 블로그 패널티 적용 비율 계산
 * blog_required && 미작성 → ratio -2% (최소 0)
 */
export function applyBlogPenalty(ratio: number, blogPenalty: boolean): number {
  if (!blogPenalty) return ratio;
  return Math.max(0, ratio - 2);
}

/**
 * 학생 1명의 월 급여 계산
 * @param settingItem 적용할 급여 설정
 * @param academyFee 수수료율 (%)
 * @param classUnits 출석 횟수 (양수 합계)
 * @param paidAmount 학생 납입금 (없으면 출석 기반 계산)
 * @param blogPenalty 블로그 패널티 적용 여부 (true 시 비율제 ratio -2%)
 */
export function calculateStudentSalary(
  settingItem: SalarySettingItem | undefined,
  academyFee: number,
  classUnits: number,
  paidAmount?: number | null,
  blogPenalty: boolean = false
): number {
  if (!settingItem || classUnits <= 0) return 0;

  // 블로그 패널티 적용된 실질 비율
  const effectiveRatio = applyBlogPenalty(settingItem.ratio, blogPenalty);

  // 납입금 없으면 출석 × 단가 — 소수 1자리 내림
  if (paidAmount === undefined || paidAmount === null) {
    return floor1(classUnits * calculateClassRate(settingItem, academyFee, effectiveRatio));
  }

  if (settingItem.type === "fixed") {
    const unitPrice = settingItem.baseTuition || settingItem.fixedRate;
    const coveredSessions = Math.min(
      classUnits,
      unitPrice > 0 ? Math.floor(paidAmount / unitPrice) : classUnits
    );
    return settingItem.fixedRate * coveredSessions;
  }

  // 비율제 — 소수 1자리 내림. 최종 합산 시 정수 내림.
  const unitPrice = settingItem.baseTuition;
  const grossByAttendance = floor1(unitPrice * classUnits);
  const effectiveBase = Math.min(paidAmount, grossByAttendance);
  return floor1(effectiveBase * (1 - academyFee / 100) * (effectiveRatio / 100));
}

/**
 * 블로그 인센티브 계산
 */
export function calculateBlogBonus(
  incentives: IncentiveConfig,
  hasBlog: boolean,
  baseSalary: number
): number {
  if (!hasBlog) return 0;
  if (incentives.blogType === "percentage") {
    return Math.round(baseSalary * (incentives.blogRate / 100));
  }
  return incentives.blogAmount;
}

/**
 * 퇴원율 달성 수당 계산
 */
export function calculateRetentionBonus(
  incentives: IncentiveConfig,
  hasRetention: boolean
): number {
  if (!hasRetention) return 0;
  return incentives.retentionAmount;
}

/**
 * 최종 급여 계산
 */
export function calculateFinalSalary(
  baseSalary: number,
  incentives: IncentiveConfig,
  settlement: { hasBlog: boolean; hasRetention: boolean; otherAmount: number }
): number {
  const blogBonus = calculateBlogBonus(incentives, settlement.hasBlog, baseSalary);
  const retentionBonus = calculateRetentionBonus(incentives, settlement.hasRetention);
  return baseSalary + blogBonus + retentionBonus + (settlement.otherAmount || 0);
}

/**
 * 뱃지 스타일 생성
 */
export function getBadgeStyle(color: string): React.CSSProperties {
  // 배경을 원색으로 채우고, 배경 명도에 따라 텍스트를 흰색/검정으로 자동 선택
  const hex = color.replace("#", "");
  const full =
    hex.length === 3
      ? hex.split("").map((c) => c + c).join("")
      : hex.padEnd(6, "0").slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // YIQ 명도 — 0~255, 128 이상이면 밝은 배경
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  const textColor = yiq >= 150 ? "#111827" : "#ffffff";
  return {
    color: textColor,
    backgroundColor: color,
    borderColor: color,
    borderWidth: 1,
  };
}

/**
 * 전체 통계 계산
 * @param salaryType 선택된 선생님의 급여 유형 (default: commission)
 * @param commissionDays mixed 유형일 때 비율제 적용 요일
 */
export function calculateStats(
  students: Student[],
  salaryConfig: SalaryConfig,
  year: number,
  month: number,
  salaryType?: SalaryType,
  commissionDays?: string[],
  subjectHint?: SalarySubject,
  teacherName?: string,
  blogPenalty: boolean = false,
  /** 시트 F열 동기화 결과 — student_id → salary_item_id */
  tierOverrides?: Record<string, string>,
  /** 학생 id → 해당 월 납부액 합계. 있으면 calculateStudentSalary에 전달되어 수납 cap 적용 */
  paidAmountByStudent?: Map<string, number>,
  /**
   * 이번 월 세션 범위 판정 함수 (선택).
   * 제공되면 이 predicate 가 true 인 날짜만 집계. (예: 3월 세션 = 3/6~4/2)
   * 미제공 시 `YYYY-MM` prefix 매칭 기본 동작.
   */
  isDateInPeriod?: (dateKey: string) => boolean
): {
  totalSalary: number;
  totalAttendance: number;
  studentCount: number;
} {
  let totalSalary = 0;
  let totalAttendance = 0;

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const inPeriod =
    isDateInPeriod ?? ((dateKey: string) => dateKey.startsWith(monthStr));

  for (const student of students) {
    if (!student.attendance) continue;

    // 이번 달(세션) 출석 합계 (급여 유형 필터링 적용).
    // 재원 외 날짜 + hours > 0 은 자동 보강으로 간주해 급여 집계 포함.
    let classUnits = 0;
    for (const [dateKey, value] of Object.entries(student.attendance)) {
      if (!inPeriod(dateKey) || value <= 0) continue;
      totalAttendance += value;
      if (isAttendanceCountable(dateKey, salaryType, commissionDays)) {
        classUnits += value;
      }
    }

    const tierOverrideId = tierOverrides?.[student.id];
    const settingItem = matchSalarySetting(student, salaryConfig, subjectHint, tierOverrideId);
    if (settingItem) {
      const baseRatio = getEffectiveRatio(settingItem, salaryConfig, teacherName);
      // teacherRatios 오버라이드가 있으면 블로그 패널티 포함해서 임시 settingItem 만들어서 계산
      const effectiveSetting: SalarySettingItem = { ...settingItem, ratio: baseRatio };
      // paidAmountByStudent 가 주어지면 수납액 기반 캡 적용 (맵에 없으면 수납 0으로 간주)
      // 맵 자체가 undefined 면 기존 동작 유지 (수납 데이터 미로드 케이스)
      const paidAmount =
        paidAmountByStudent !== undefined
          ? paidAmountByStudent.get(student.id) ?? 0
          : null;
      totalSalary += calculateStudentSalary(
        effectiveSetting,
        salaryConfig.academyFee,
        classUnits,
        paidAmount,
        blogPenalty
      );
    }
  }

  // 가상 행(`{studentId}|{className}`) 중복 제거 — 동일 원본 학생은 1명으로 카운트
  const uniqueStudentIds = new Set(students.map((s) => (s.id || "").split("|")[0]));

  return {
    // 최종 합계는 정수 내림
    totalSalary: Math.floor(totalSalary),
    totalAttendance,
    studentCount: uniqueStudentIds.size,
  };
}

/**
 * 학생 학년 문자열을 급여 그룹으로 변환
 * (고3 중 수능반은 별도 오버라이드로 처리)
 */
export function gradeToGroup(grade: string | undefined): SalaryGroup | undefined {
  const g = grade || "";
  if (g.includes("초")) return "초등";
  if (g.includes("중")) return "중등";
  if (g.includes("고")) return "고등";
  return undefined;
}

/**
 * enrollment 과목 문자열을 급여 과목으로 변환
 */
export function subjectToSalarySubject(subject: string | undefined): SalarySubject | undefined {
  if (!subject) return undefined;
  if (subject === "math" || subject === "highmath") return "math";
  if (subject === "english") return "english";
  if (["korean", "science", "other"].includes(subject)) return "other";
  return undefined;
}

/**
 * 학생에게 적용할 급여 설정 매칭
 * 1. tierOverrideId (시트 F열 동기화) 최우선
 * 2. salarySettingOverrides 오버라이드
 * 3. subject + group으로 기본 항목 매칭
 */
export function matchSalarySetting(
  student: Student,
  salaryConfig: SalaryConfig,
  subjectHint?: SalarySubject,
  tierOverrideId?: string
): SalarySettingItem | undefined {
  // 시트 F열 tier 오버라이드 최우선
  if (tierOverrideId) {
    const found = salaryConfig.items.find((i) => i.id === tierOverrideId);
    if (found) return found;
  }

  // 오버라이드가 있으면 우선
  if (student.salarySettingOverrides && student.group) {
    const overrideId = student.salarySettingOverrides[student.group];
    if (overrideId) {
      const found = salaryConfig.items.find((i) => i.id === overrideId);
      if (found) return found;
    }
  }

  // 학년 그룹 판단
  const group = gradeToGroup(student.grade);

  // 과목 판단: hint 우선, 없으면 학생 첫 번째 enrollment의 subject
  const subject: SalarySubject | undefined =
    subjectHint || subjectToSalarySubject(student.enrollments?.[0]?.subject);

  // 과목+그룹 매칭
  if (subject && group) {
    const matched = salaryConfig.items.find(
      (i) => i.subject === subject && i.group === group
    );
    if (matched) return matched;
  }

  // 그룹만이라도 매칭
  if (group) {
    const matched = salaryConfig.items.find((i) => i.group === group);
    if (matched) return matched;
  }

  // 기본값: 첫 번째 항목
  return salaryConfig.items[0];
}

/**
 * 선생님별 비율 적용: 기본 item.ratio에 teacherRatios 오버라이드가 있으면 교체
 */
export function getEffectiveRatio(
  item: SalarySettingItem,
  salaryConfig: SalaryConfig,
  teacherName?: string
): number {
  if (teacherName && salaryConfig.teacherRatios && item.subject && item.group) {
    const perTeacher = salaryConfig.teacherRatios[teacherName];
    const perSubject = perTeacher?.[item.subject];
    const override = perSubject?.[item.group];
    if (typeof override === "number") return override;
  }
  return item.ratio;
}
