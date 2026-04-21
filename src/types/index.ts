// ==========================================
// 급여 설정 타입
// ==========================================

/** 급여 유형: 고정급 | 비율제 */
export type SalaryType = "fixed" | "percentage";

/** 과목 구분 */
export type SalarySubject = "math" | "english" | "other";

/** 과정 그룹 */
export type SalaryGroup = "초등" | "중등" | "고등" | "수능" | "특강";

/** 과정별 급여 설정 항목 */
export interface SalarySettingItem {
  id: string;
  name: string;           // 예: "초등 2T", "킬러문제"
  subject?: SalarySubject; // 과목
  group?: SalaryGroup;     // 학년 그룹
  color: string;          // 뱃지 색상 hex
  type: SalaryType;
  fixedRate: number;      // 고정급일 때 1회당 금액
  baseTuition: number;    // 기본 수업료 (비율제 기준 단가)
  ratio: number;          // 비율제일 때 교사 비율 (%) — 기본값
  unitPrice: number;      // 수업 단가 (청구 기준)
}

/**
 * 선생님별 비율 오버라이드
 * 형식: { [선생님이름]: { [과목]: { [그룹]: 비율% } } }
 * 예: { "현미진": { math: { "초등": 46, "중등": 46, ... } } }
 */
export type TeacherRatios = {
  [teacherName: string]: Partial<{
    [S in SalarySubject]: Partial<Record<SalaryGroup, number>>;
  }>;
};

/** 인센티브 설정 */
export interface IncentiveConfig {
  blogType: "fixed" | "percentage";
  blogAmount: number;     // 고정금 블로그 인센티브
  blogRate: number;       // 비율 블로그 인센티브 (%)
  retentionAmount: number;    // 퇴원율 달성 수당
  retentionTargetRate: number; // 목표 퇴원율 (%)
}

/** 전체 급여 설정 */
export interface SalaryConfig {
  academyFee: number;     // 카드/행정 수수료 (%)
  items: SalarySettingItem[];
  teacherRatios?: TeacherRatios;
  incentives: IncentiveConfig;
}

/** 월별 정산 데이터 */
export interface MonthlySettlement {
  hasBlog: boolean;
  hasRetention: boolean;
  otherAmount: number;
  note: string;
  isFinalized?: boolean;
  finalizedAt?: string;
  salaryConfig?: SalaryConfig; // 확정 시 스냅샷
}

// ==========================================
// 선생님 타입
// ==========================================

export type TeacherType = "salary" | "commission";

export interface Teacher {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  subjects: string[];
  status: string;
  englishName?: string;
}

// ==========================================
// 학생 타입
// ==========================================

export interface Enrollment {
  subject: string;
  classId?: string;
  className?: string;
  staffId?: string;
  teacher?: string;
  days?: string[];
  schedule?: string[];
  startDate?: string;
  endDate?: string;
  onHold?: boolean;
}

export interface Student {
  id: string;
  name: string;
  studentCode?: string;  // 원생고유번호 (수납내역과 매칭용)
  school?: string;
  grade?: string;
  status: string;
  campus?: string;
  startDate?: string;
  endDate?: string;
  enrollments?: Enrollment[];
  // 출석부 전용 필드
  group?: string;                        // 반 이름 (수업 그룹)
  mainClasses?: string[];                // 담임 수업
  slotClasses?: string[];                // 부담임 수업
  days?: string[];                       // 수업 요일 ["월", "화", ...]
  attendance?: Record<string, number>;   // dateKey → 출석값
  memos?: Record<string, string>;        // dateKey → 메모
  homework?: Record<string, boolean>;    // dateKey → 숙제 완료
  cellColors?: Record<string, string>;   // dateKey → 셀 색상
  salarySettingOverrides?: Record<string, string>; // className → salarySettingId
}

// ==========================================
// 상담 타입 (ijw-calander 공유 — student_consultations)
// ==========================================

export type ConsultationType = "parent" | "student";
export type ConsultationCategory =
  | "academic"
  | "behavior"
  | "attendance"
  | "progress"
  | "concern"
  | "compliment"
  | "complaint"
  | "general"
  | "other";
export type ConsultationSubject = "math" | "english";
export type StudentMood = "positive" | "neutral" | "negative";

/**
 * 상담 기록 — ijw-calander 프로젝트의 `student_consultations` 컬렉션
 * 현재 출석부 웹앱에서는 읽기 전용으로 사용
 */
export interface Consultation {
  id: string;
  studentId: string;
  studentName: string;
  type: ConsultationType;
  consultantId: string;
  consultantName: string;
  date: string;              // YYYY-MM-DD
  time?: string;             // HH:mm
  duration?: number;         // 분
  category: ConsultationCategory;
  subject?: ConsultationSubject;
  title: string;
  content: string;
  parentName?: string;
  parentRelation?: string;
  studentMood?: StudentMood;
  followUpNeeded: boolean;
  followUpDate?: string;     // YYYY-MM-DD
  followUpDone: boolean;
  followUpNotes?: string;
  createdAt: number;         // ms epoch
  updatedAt: number;         // ms epoch
  createdBy: string;
}

// ==========================================
// 세션 기간 타입 (ijw-calander 공유)
// ==========================================

/** 날짜 범위 (YYYY-MM-DD) */
export interface DateRange {
  startDate: string;
  endDate: string;
}

/**
 * 세션 기간 — 월별로 여러 날짜 범위로 정의되는 출석/수업 기간
 * Firestore 컬렉션: `session_periods` (ijw-calander와 공유)
 * 문서 ID 규칙: `{year}-{category}-{month}` 예) "2026-math-3"
 */
export interface SessionPeriod {
  id: string;
  year: number;
  category: string;   // 과목 코드 — 현재 프로젝트의 subject 체계 사용 (math, english, korean 등)
  month: number;      // 1~12 (세션이 속한 대표 월)
  ranges: DateRange[];
  sessions: number;   // 기본 수업 회수 (정산/시수 참고용)
  createdAt?: string;
  updatedAt?: string;
}

/** 출석부 보기 모드 */
export type AttendanceViewMode = "monthly" | "session";

// ==========================================
// 출석 기록 타입 (Supabase)
// ==========================================

export interface AttendanceRecord {
  id: string;
  teacher_id: string;
  student_id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  hours: number;
  is_makeup: boolean;
}

// ==========================================
// 셀 색상 팔레트
// ==========================================

export const CELL_COLORS = [
  { key: "orange", label: "주황 (기본)", hex: "#fed7aa" },
  { key: "yellow", label: "노랑", hex: "#fef08a" },
  { key: "green", label: "초록", hex: "#bbf7d0" },
  { key: "emerald", label: "에메랄드", hex: "#a7f3d0" },
  { key: "cyan", label: "하늘", hex: "#a5f3fc" },
  { key: "blue", label: "파랑", hex: "#bfdbfe" },
  { key: "violet", label: "보라", hex: "#ddd6fe" },
  { key: "pink", label: "분홍", hex: "#fbcfe8" },
  { key: "rose", label: "장미", hex: "#fecdd3" },
  { key: "gray", label: "회색", hex: "#d1d5db" },
] as const;

// ==========================================
// 기본값
// ==========================================

// 기본 단가 생성 헬퍼
function mkItem(
  id: string,
  name: string,
  subject: SalarySubject,
  group: SalaryGroup,
  color: string,
  price: number
): SalarySettingItem {
  return {
    id,
    name,
    subject,
    group,
    color,
    type: "percentage",
    fixedRate: 0,
    baseTuition: price,
    ratio: 45,
    unitPrice: price,
  };
}

// 과목×그룹 색상 팔레트
const C = {
  mathElem: "#FCD34D",
  mathMid: "#F97316",
  mathHigh: "#EF4444",
  mathCsat: "#B91C1C",
  mathSp: "#7C2D12",
  engElem: "#60A5FA",
  engMid: "#2563EB",
  engHigh: "#1D4ED8",
  engSp: "#1E40AF",
  otherMid: "#8B5CF6",
  otherHigh: "#7C3AED",
  otherSp: "#6D28D9",
};

export const INITIAL_SALARY_CONFIG: SalaryConfig = {
  academyFee: 8.9,
  items: [
    // ===== 수학 =====
    // 초등
    mkItem("math-elem-3t", "초등 3T", "math", "초등", C.mathElem, 21250),
    mkItem("math-elem-2t", "초등 2T", "math", "초등", C.mathElem, 22500),
    mkItem("math-elem-med", "의치대 초등", "math", "초등", C.mathElem, 22500),
    // 중등
    mkItem("math-mid-3t", "중등 3T", "math", "중등", C.mathMid, 24000),
    mkItem("math-mid-2t", "중등 2T", "math", "중등", C.mathMid, 25000),
    mkItem("math-mid-med", "의치대 중등", "math", "중등", C.mathMid, 25000),
    // 고등
    mkItem("math-high-3t", "고등 3T", "math", "고등", C.mathHigh, 27250),
    mkItem("math-high-2t", "고등 2T", "math", "고등", C.mathHigh, 29250),
    mkItem("math-high-med", "의치대 고등", "math", "고등", C.mathHigh, 29167),
    mkItem("math-algebra", "수학I (대수)", "math", "고등", C.mathHigh, 31250),
    mkItem("math-calc1", "수학II (미적분I)", "math", "고등", C.mathHigh, 31250),
    mkItem("math-calc2", "미적분 (미적분II)", "math", "고등", C.mathHigh, 31250),
    mkItem("math-stat", "확률과 통계", "math", "고등", C.mathHigh, 31250),
    // 수능
    mkItem("math-csat", "수능", "math", "수능", C.mathCsat, 37500),
    // 특강
    mkItem("math-killer", "킬러문제", "math", "특강", C.mathSp, 29250),
    mkItem("math-abs-grade", "절대등급", "math", "특강", C.mathSp, 32500),
    mkItem("math-mathmong", "매쓰몽", "math", "특강", C.mathSp, 30000),
    mkItem("math-elem-sp", "초등특강", "math", "특강", C.mathSp, 21250),
    mkItem("math-mid-sp-24", "중등특강(2.4)", "math", "특강", C.mathSp, 24000),
    mkItem("math-mid-sp-25", "중등특강(2.5)", "math", "특강", C.mathSp, 25000),
    mkItem("math-mid-sp-333", "중등특강(3.33)", "math", "특강", C.mathSp, 33333),
    mkItem("math-h1-sp", "고1특강", "math", "특강", C.mathSp, 27250),
    mkItem("math-h2-sp", "고2특강", "math", "특강", C.mathSp, 31250),
    mkItem("math-mid-func-sp", "중등함수특강", "math", "특강", C.mathSp, 30000),
    mkItem("math-mid-sp-2", "중등특강2", "math", "특강", C.mathSp, 36000),

    // ===== 영어 =====
    // 영어는 수학과 단위(U=40분) 체계가 달라 단가도 다르다.
    // Apps Script `getFixedUnitPrice` 규칙 + Sarah 시트 26.03 I열 관찰값 기준.
    // 초등
    mkItem("eng-elem-3t", "초등 3T", "english", "초등", C.engElem, 12000),
    mkItem("eng-elem-2t", "초등 2T", "english", "초등", C.engElem, 12000),
    mkItem("eng-eie-phonics", "EIE파닉스", "english", "초등", C.engElem, 6250),
    mkItem("eng-eie-rookies", "EIE루키스", "english", "초등", C.engElem, 7500),
    mkItem("eng-eie-readers", "EIE리더스", "english", "초등", C.engElem, 7500),
    mkItem("eng-elem-med", "의치대 초등", "english", "초등", C.engElem, 12500),
    mkItem("eng-elem-bridge", "초등브릿지", "english", "초등", C.engElem, 12000),
    // 중등
    mkItem("eng-mid-3t", "중등 3T", "english", "중등", C.engMid, 12000),
    mkItem("eng-mid-2t", "중등 2T", "english", "중등", C.engMid, 12000),
    mkItem("eng-mid-med", "의치대 중등", "english", "중등", C.engMid, 12500),
    mkItem("eng-mid-bridge", "중등브릿지", "english", "중등", C.engMid, 8000),
    mkItem("eng-mid-top", "중등TOP", "english", "중등", C.engMid, 12500),
    // 고등
    mkItem("eng-high-3t", "고등 3T", "english", "고등", C.engHigh, 13625),
    mkItem("eng-high-2t", "고등 2T", "english", "고등", C.engHigh, 13625),
    mkItem("eng-high-med", "의치대 고등", "english", "고등", C.engHigh, 13625),
    mkItem("eng-high-bridge", "고등브릿지", "english", "고등", C.engHigh, 13625),
    // 특강
    mkItem("eng-elem-sp", "초등특강", "english", "특강", C.engSp, 12000),
    mkItem("eng-mid-sp", "중등특강", "english", "특강", C.engSp, 12000),
    mkItem("eng-h1-sp", "고1특강", "english", "특강", C.engSp, 13625),
    mkItem("eng-h2-sp", "고2특강", "english", "특강", C.engSp, 13625),
    mkItem("eng-elem-writ-sp", "초등영작특강", "english", "특강", C.engSp, 12000),
    mkItem("eng-mid-writ-sp", "중등영작특강", "english", "특강", C.engSp, 12500),
    mkItem("eng-high-writ-sp", "고등영작특강", "english", "특강", C.engSp, 13625),

    // ===== 기타 =====
    mkItem("other-mid-kor-re", "중등국어(재)", "other", "중등", C.otherMid, 25000),
    mkItem("other-mid-kor-bi", "중등국어(비)", "other", "중등", C.otherMid, 31250),
    mkItem("other-sci-regular", "과학정규", "other", "중등", C.otherMid, 25000),
    mkItem("other-int-sci", "통합과학", "other", "고등", C.otherHigh, 30000),
    mkItem("other-sci-sp1", "과학특강1", "other", "특강", C.otherSp, 20833),
    mkItem("other-sci-sp2", "과학특강2", "other", "특강", C.otherSp, 21250),
  ],
  teacherRatios: {
    // 수학 선생님
    "현미진":       { math: { "초등": 46,   "중등": 46,   "고등": 47.5, "수능": 50, "특강": 50 } },
    "김유정":       { math: { "초등": 48.5, "중등": 48.5, "고등": 48.5, "수능": 50, "특강": 50 } },
    "김은정":       { math: { "초등": 47.5, "중등": 48,   "고등": 48,   "수능": 50, "특강": 50 } },
    "김화영":       { math: { "초등": 48,   "중등": 48,   "고등": 48.5, "수능": 50, "특강": 50 } },
    "임다영":       { math: { "초등": 48,   "중등": 48.5, "고등": 48.5, "수능": 50, "특강": 50 } },
    "이수진":       { math: { "초등": 45,   "중등": 47.5, "고등": 47.5, "수능": 50, "특강": 50 } },
    "김민주":       { math: { "초등": 45,   "중등": 46,   "고등": 47,   "수능": 50, "특강": 50 } },
    "김윤하":       { math: { "초등": 45,   "중등": 45,   "고등": 45,   "수능": 48, "특강": 50 } },
    "이성우":       { math: { "초등": 50,   "중등": 50,   "고등": 50,   "수능": 50, "특강": 50 } },
    // 영어 선생님
    "이정아(Julie)":  { english: { "초등": 48.5, "중등": 48.5, "고등": 48.5, "수능": 50, "특강": 50 } },
    "이민아(Mina)":   { english: { "초등": 45,   "중등": 47.5, "고등": 48,   "수능": 50, "특강": 50 } },
    "강보경(Sarah)":  { english: { "초등": 47.5, "중등": 47.5, "고등": 48,   "수능": 50, "특강": 50 } },
    "신명진(GINA)":   { english: { "초등": 46,   "중등": 46,   "고등": 47.5, "수능": 50, "특강": 50 } },
    "추민아(Jane)":   { english: { "초등": 45,   "중등": 45,   "고등": 47.5, "수능": 50, "특강": 50 } },
    "박나연(Jenny)":  { english: { "초등": 43,   "중등": 44,   "고등": 45.5, "수능": 50, "특강": 50 } },
    "정은지":         { english: { "초등": 43,   "중등": 44,   "고등": 45.5, "수능": 50, "특강": 50 } },
    // 과학 선생님 (other 과목) — 시트 R3 요율 기준
    "마수호":         { other:   { "초등": 50,   "중등": 50,   "고등": 50,   "수능": 50, "특강": 50 } },
  },
  incentives: {
    blogType: "fixed",
    blogAmount: 50000,
    blogRate: 2,
    retentionAmount: 100000,
    retentionTargetRate: 5,
  },
};

export const INITIAL_SETTLEMENT: MonthlySettlement = {
  hasBlog: false,
  hasRetention: false,
  otherAmount: 0,
  note: "",
};

export const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;
export const DAY_ORDER = ["월", "화", "수", "목", "금", "토", "일"] as const;
