"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { Student, SalaryConfig } from "@/types";
import { DAY_LABELS } from "@/types";
import { formatDateKey, formatDateDisplay, getDaysInMonth } from "@/lib/date";
import StudentRow from "./StudentRow";
import GroupHeader from "./GroupHeader";
import ContextMenu from "./ContextMenu";

type SortMode = "class" | "name" | "day";

interface Props {
  students: Student[];
  year: number;
  month: number;
  /** 선택된 과목 — 출석/등록 단위 결정 (영어=U, 그 외=T) */
  subject?: string;
  salaryConfig: SalaryConfig;
  /** 시트 F열 동기화 결과 — student_id → salary_item_id */
  tierOverrides?: Record<string, string>;
  highlightWeekends: boolean;
  showExpectedBilling: boolean;
  /** 이번 달 실질 납부액 컬럼 표시 */
  showPaidAmount: boolean;
  /** 실제 계산된 급여 컬럼 표시 (상단 이번 달 급여와 동일 공식) */
  showActualSalary: boolean;
  /** 학생 id → 이번 달 수납 합계 */
  paidAmountByStudent?: Map<string, number>;
  /** 학생 id → 실급여(= calculateStudentSalary 결과) */
  actualSalaryByStudent?: Map<string, number>;
  sortMode: SortMode;
  /**
   * 학생 검색어 — 이름/학교/학년 substring (대소문자 무시).
   *   visibleStudents 단계에서 filter (계산 결과에는 영향 없음 — 표시만 좁힘).
   */
  studentSearch?: string;
  /** 세션 모드 등에서 날짜 범위를 외부에서 지정할 때 사용 */
  overrideDates?: Date[];
  cellWidthPx: number;
  cellHeightPx: number;
  hiddenDateSet: Set<string>;
  hiddenStudentSet: Set<string>;
  holidayDateSet?: Set<string>;
  holidayNameMap?: Map<string, string>;
  /** 학생별 등록차수 (studentId → 회수) */
  termCountMap?: Map<string, number>;
  onHideDate: (dateKey: string) => void;
  onHideStudent: (studentId: string) => void;
  onAttendanceChange: (studentId: string, dateKey: string, value: number | null) => void;
  onMemoChange: (studentId: string, dateKey: string, memo: string) => void;
  onCellColorChange: (studentId: string, dateKey: string, color: string | null) => void;
  onHomeworkChange: (studentId: string, dateKey: string, done: boolean) => void;
  /** 다른 사용자가 편집 중인 셀 (key: "studentId|dateKey") → 편집자 정보 */
  editingByPeers?: Map<string, { email: string; name: string }>;
  setEditingCell?: (studentId: string, date: string, editing: boolean) => void;
  /**
   * 정산 breakdown 모달 트리거 (audit #6).
   *   학생 ℹ 버튼 클릭 시 부모(AttendancePage) 가 모달 열도록.
   */
  onShowBreakdown?: (studentId: string) => void;
  /**
   * 분반 quick-add (관리자만).
   *   학생 행 🔧 버튼 클릭 시 부모(AttendancePage) 가 TierOverrideModal 열기.
   */
  onAddTier?: (studentId: string) => void;
  /**
   * 일자 컬럼 폭 드래그 리사이즈 (audit H).
   *   thead 핸들 드래그 → 새 폭(px) 호출. 부모가 cellWidthPx 갱신.
   */
  onColumnResize?: (px: number) => void;
}

export default function AttendanceTable({
  students,
  year,
  month,
  subject,
  salaryConfig,
  tierOverrides,
  highlightWeekends,
  showExpectedBilling,
  showPaidAmount,
  showActualSalary,
  paidAmountByStudent,
  actualSalaryByStudent,
  sortMode,
  studentSearch,
  overrideDates,
  cellWidthPx,
  cellHeightPx,
  hiddenDateSet,
  hiddenStudentSet,
  holidayDateSet,
  holidayNameMap,
  termCountMap,
  onHideDate,
  onHideStudent,
  onAttendanceChange,
  onMemoChange,
  onCellColorChange,
  onHomeworkChange,
  editingByPeers,
  onShowBreakdown,
  onAddTier,
  onColumnResize,
}: Props) {
  const allDates = useMemo(
    () => overrideDates && overrideDates.length > 0 ? overrideDates : getDaysInMonth(year, month),
    [overrideDates, year, month]
  );
  // 세션 모드(overrideDates 있음)에서는 명시적 날짜이므로 주말 필터 미적용
  const isSessionDriven = !!(overrideDates && overrideDates.length > 0);
  const dates = useMemo(
    () =>
      allDates.filter((d) => {
        if (hiddenDateSet.has(formatDateKey(d))) return false;
        // 월별 모드에서 토글 OFF면 토/일 열 제거
        if (!isSessionDriven && !highlightWeekends) {
          const day = d.getDay();
          if (day === 0 || day === 6) return false;
        }
        return true;
      }),
    [allDates, hiddenDateSet, highlightWeekends, isSessionDriven]
  );
  const dateInfos = useMemo(() => dates.map(formatDateDisplay), [dates]);

  // 숨긴 학생 필터링 + 검색어 필터.
  //   검색어는 이름/학교/학년 substring 매칭 (대소문자 무시).
  //   계산 결과(상단 시수·실급여 등)는 studentRows 단계에서 이미 결정되므로,
  //   여기서 좁히는 건 화면 표시 줄 뿐.
  const visibleStudents = useMemo(() => {
    const q = (studentSearch || "").trim().toLowerCase();
    return students.filter((s) => {
      if (hiddenStudentSet.has(s.id)) return false;
      if (!q) return true;
      const haystack = [
        s.name || "",
        s.school || "",
        s.grade || "",
        s.group || "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [students, hiddenStudentSet, studentSearch]);

  // 그룹 접기 상태
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // 그룹 순서
  const [groupOrder, setGroupOrder] = useState<string[]>([]);
  // 컨텍스트 메뉴
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    studentId: string;
    dateKey: string;
  } | null>(null);

  // 키보드 입력용 활성 셀 (시트의 selected cell 과 동등)
  //   클릭 또는 키보드 네비게이션으로 설정. 숫자 키 입력·Tab/Enter/방향키·
  //   Backspace/Esc·Ctrl+Z 모두 활성 셀이 있을 때만 동작.
  const [activeCell, setActiveCell] = useState<{
    studentId: string;
    dateKey: string;
  } | null>(null);

  // 셀 입력 버퍼 — 활성 셀에 누적 중인 숫자/소수점 문자열.
  //   "1", "0.5", "1.5", "2.25" 등 자유롭게 타이핑 가능.
  //   Enter/Tab/Arrow → 파싱 후 셀에 저장 + 이동.
  //   Esc → 입력 취소.
  const [cellInput, setCellInput] = useState<string | null>(null);

  // Undo 스택 — 최근 50개 변경 (학생, 날짜, 이전 값) 보관.
  //   Ctrl+Z 시 마지막 항목 pop 하여 역적용.
  const undoStackRef = useRef<
    Array<{ studentId: string; dateKey: string; oldValue: number | null }>
  >([]);

  // 시트 Ctrl+C / Ctrl+V 대체 — 셀 값 복사 버퍼.
  //   Ref 로 저장 (값 변경에 react re-render 불필요).
  //   복사된 셀은 시각적 표시 (점선 테두리) 위해 별도 state 보관.
  const clipboardCellRef = useRef<{ value: number | null } | null>(null);
  const [copiedCellKey, setCopiedCellKey] = useState<string | null>(null);

  // 시트 범위 선택 — activeCell(anchor) + selectionFocus 사이 사각형.
  //   selectionFocus === null → single cell 선택 (= activeCell).
  //   Shift+클릭 / Shift+방향키로 focus 갱신.
  //   범위 입력 시 모든 셀에 동일 값 적용.
  const [selectionFocus, setSelectionFocus] = useState<{
    studentId: string;
    dateKey: string;
  } | null>(null);

  // 시트 드래그 채우기 — 활성 셀 우하단 핸들에서 시작.
  //   true 면 mousemove 로 selectionFocus 갱신 (Task B 시각화 재사용).
  //   mouseup 시 시작 셀 값을 selection 영역 전체에 채우고 종료.
  const [isDragFilling, setIsDragFilling] = useState(false);
  const dragFillStartValueRef = useRef<number | null>(null);

  // 일자 컬럼 폭 드래그 리사이즈 (audit H).
  //   resizing.startX = 시작 mouse X, startWidth = 시작 시점 cellWidthPx.
  //   드래그 중 시각화 + 부드러운 갱신.
  const resizingRef = useRef<{ startX: number; startWidth: number } | null>(
    null
  );
  const [isResizing, setIsResizing] = useState(false);

  // 키보드 네비게이션용 학생 순서 — 실제 화면 표시 순서와 일치해야 ArrowUp/Down
  // 이 점프하지 않음. sortMode + groupOrder + collapsedGroups 모두 반영.
  // (renderRows 의 로직을 그대로 재현)
  const DAY_ORDER_IDX_NAV = ["월", "화", "수", "목", "금", "토", "일"];
  const navStudents = useMemo(() => {
    if (sortMode === "name" || sortMode === "day") {
      const getFirstDayIdx = (s: Student): number => {
        if (!s.days || s.days.length === 0) return 999;
        const sorted = [...s.days].sort(
          (a, b) =>
            DAY_ORDER_IDX_NAV.indexOf(a) - DAY_ORDER_IDX_NAV.indexOf(b)
        );
        return DAY_ORDER_IDX_NAV.indexOf(sorted[0]);
      };
      return [...visibleStudents].sort((a, b) => {
        if (sortMode === "day") {
          const diff = getFirstDayIdx(a) - getFirstDayIdx(b);
          if (diff !== 0) return diff;
        }
        return a.name.localeCompare(b.name, "ko");
      });
    }
    // class mode — 그룹별로 정렬, 접힌 그룹은 제외
    const groupMap = new Map<string, Student[]>();
    for (const s of visibleStudents) {
      const group = s.group || "미분류";
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(s);
    }
    const allGroups = Array.from(groupMap.keys());
    const orderedGroups = [
      ...groupOrder.filter((g) => allGroups.includes(g)),
      ...allGroups.filter((g) => !groupOrder.includes(g)),
    ];
    const out: Student[] = [];
    for (const group of orderedGroups) {
      if (collapsedGroups.has(group)) continue;
      const gss = groupMap.get(group) || [];
      const sorted = [...gss].sort((a, b) => a.name.localeCompare(b.name, "ko"));
      out.push(...sorted);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleStudents, sortMode, groupOrder, collapsedGroups]);

  // 그룹별 학생 정렬
  const { rows, groups } = useMemo(() => {
    if (sortMode === "name") {
      const sorted = [...visibleStudents].sort((a, b) => a.name.localeCompare(b.name, "ko"));
      return { rows: sorted, groups: [] as string[] };
    }

    // 수업별 그룹
    const groupMap = new Map<string, Student[]>();
    for (const s of visibleStudents) {
      const group = s.group || "미분류";
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(s);
    }

    // 그룹 순서 결정
    const allGroups = Array.from(groupMap.keys());
    const orderedGroups = [
      ...groupOrder.filter((g) => allGroups.includes(g)),
      ...allGroups.filter((g) => !groupOrder.includes(g)),
    ];

    return { rows: visibleStudents, groups: orderedGroups };
  }, [visibleStudents, sortMode, groupOrder]);

  const toggleCollapse = useCallback((group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  const moveGroup = useCallback(
    (group: string, direction: "up" | "down") => {
      setGroupOrder((prev) => {
        const allGroups = groups.length > 0 ? groups : Array.from(new Set(students.map((s) => s.group || "미분류")));
        const order = prev.length > 0 ? [...prev] : [...allGroups];
        const idx = order.indexOf(group);
        if (idx < 0) return prev;
        const swapIdx = direction === "up" ? idx - 1 : idx + 1;
        if (swapIdx < 0 || swapIdx >= order.length) return prev;
        [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
        return order;
      });
    },
    [groups, students]
  );

  // 셀 클릭: 토글 (미체크 → 1 → 0 → 초기화)
  // students / onAttendanceChange 가 매 출석 변경 시 새 참조가 되므로
  // 콜백 자체는 ref 기반으로 안정화하여 StudentRow memo 가 효과를 보도록 함
  const studentsRef = useRef(students);
  const onAttendanceChangeRef = useRef(onAttendanceChange);
  useEffect(() => {
    studentsRef.current = students;
    onAttendanceChangeRef.current = onAttendanceChange;
  });
  // undo 스택에 푸시 (값이 실제로 바뀔 때만, 최대 50개 유지)
  const pushUndo = useCallback(
    (studentId: string, dateKey: string, newValue: number | null) => {
      const s = studentsRef.current.find((x) => x.id === studentId);
      const oldValue = s?.attendance?.[dateKey] ?? null;
      if (oldValue === newValue) return;
      undoStackRef.current.push({ studentId, dateKey, oldValue });
      if (undoStackRef.current.length > 50) undoStackRef.current.shift();
    },
    []
  );

  // 셀 값 설정 (undo 기록 포함)
  const setCellValue = useCallback(
    (studentId: string, dateKey: string, value: number | null) => {
      pushUndo(studentId, dateKey, value);
      onAttendanceChangeRef.current(studentId, dateKey, value);
    },
    [pushUndo]
  );

  const handleCellClick = useCallback(
    (studentId: string, dateKey: string, extendSelection: boolean = false) => {
      // Shift+클릭: 활성 셀(anchor)은 유지, focus 만 갱신 → 범위 선택.
      if (extendSelection && activeCell) {
        setSelectionFocus({ studentId, dateKey });
        return;
      }
      // 일반 클릭: anchor 변경 + 기존 범위 해제 + 입력 버퍼 커밋
      setActiveCell((prev) => {
        if (
          prev &&
          (prev.studentId !== studentId || prev.dateKey !== dateKey) &&
          cellInput !== null
        ) {
          const trimmed = cellInput.trim();
          if (trimmed !== "" && trimmed !== ".") {
            const n = Number(trimmed);
            if (!isNaN(n)) setCellValue(prev.studentId, prev.dateKey, n);
          }
        }
        return { studentId, dateKey };
      });
      setSelectionFocus(null);
      setCellInput(null);
    },
    [cellInput, setCellValue, activeCell]
  );

  // 입력 모드(<input>) onChange 콜백 — 버퍼 갱신
  const handleCellInputChange = useCallback((value: string) => {
    setCellInput(value);
  }, []);

  // 입력 모드 키 액션 — 커밋 + 이동, 취소
  const handleCellInputAction = useCallback(
    (
      action:
        | "commit-down"
        | "commit-up"
        | "commit-left"
        | "commit-right"
        | "commit-tab-fwd"
        | "commit-tab-back"
        | "cancel"
    ) => {
      const cur = activeCell;
      if (!cur) return;
      // 취소
      if (action === "cancel") {
        setCellInput(null);
        return;
      }
      // 버퍼 커밋
      const buf = cellInput;
      if (buf !== null) {
        const trimmed = buf.trim();
        setCellInput(null);
        if (trimmed !== "" && trimmed !== ".") {
          const n = Number(trimmed);
          if (!isNaN(n)) setCellValue(cur.studentId, cur.dateKey, n);
        }
      }
      // 이동
      const stus = visibleStudentsRef.current;
      const dks = dateKeysRef.current;
      const row = stus.findIndex((s) => s.id === cur.studentId);
      const col = dks.indexOf(cur.dateKey);
      if (row < 0 || col < 0) return;
      let dx = 0,
        dy = 0;
      if (action === "commit-down") dy = 1;
      else if (action === "commit-up") dy = -1;
      else if (action === "commit-right") dx = 1;
      else if (action === "commit-left") dx = -1;
      else if (action === "commit-tab-fwd") dx = 1;
      else if (action === "commit-tab-back") dx = -1;
      const newRow = Math.max(0, Math.min(stus.length - 1, row + dy));
      const newCol = Math.max(0, Math.min(dks.length - 1, col + dx));
      const ns = stus[newRow];
      const nk = dks[newCol];
      if (ns && nk) setActiveCell({ studentId: ns.id, dateKey: nk });
    },
    [activeCell, cellInput, setCellValue]
  );

  // 우클릭: 컨텍스트 메뉴
  const handleCellRightClick = useCallback(
    (e: React.MouseEvent, studentId: string, dateKey: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, studentId, dateKey });
    },
    []
  );

  // ─── 키보드 네비게이션 / 입력 / Undo ───────────────
  //   시트와 동일한 사용성: 활성 셀에서 0~9 직접 타이핑·방향키·Tab/Enter·
  //   Backspace/Delete·Esc·Ctrl+Z 지원.
  //
  //   Navigation grid: visibleStudents × dates 기준. 컨텍스트 메뉴/모달이
  //   열려 있거나 input/textarea 에 포커스된 경우 무시.
  const dateKeysForNav = useMemo(
    () => dates.map((d) => formatDateKey(d)),
    [dates]
  );
  // navStudents = 화면 표시 순서 (그룹/정렬/접힘 반영). 키 네비게이션 기준.
  const visibleStudentsRef = useRef(navStudents);
  const dateKeysRef = useRef(dateKeysForNav);
  useEffect(() => {
    visibleStudentsRef.current = navStudents;
    dateKeysRef.current = dateKeysForNav;
  });

  // 월/과목 변경 시 활성 셀·입력 버퍼·undo 스택·선택 범위 리셋
  useEffect(() => {
    setActiveCell(null);
    setCellInput(null);
    setSelectionFocus(null);
    undoStackRef.current = [];
  }, [year, month, subject]);

  // 선택 범위 사각형 — anchor(activeCell) ↔ focus(selectionFocus) 기준으로
  //   navStudents × dates 좌표 공간에서 모든 셀 키 집합을 만든다.
  //   selectionFocus 가 null 이거나 anchor 와 같으면 single cell 선택.
  const selectedKeys = useMemo<Set<string>>(() => {
    if (!activeCell) return new Set();
    const focus = selectionFocus || activeCell;
    if (
      focus.studentId === activeCell.studentId &&
      focus.dateKey === activeCell.dateKey
    ) {
      return new Set([`${activeCell.studentId}|${activeCell.dateKey}`]);
    }
    const stus = navStudents;
    const dks = dateKeysForNav;
    const rA = stus.findIndex((s) => s.id === activeCell.studentId);
    const rB = stus.findIndex((s) => s.id === focus.studentId);
    const cA = dks.indexOf(activeCell.dateKey);
    const cB = dks.indexOf(focus.dateKey);
    if (rA < 0 || rB < 0 || cA < 0 || cB < 0) {
      return new Set([`${activeCell.studentId}|${activeCell.dateKey}`]);
    }
    const r1 = Math.min(rA, rB);
    const r2 = Math.max(rA, rB);
    const c1 = Math.min(cA, cB);
    const c2 = Math.max(cA, cB);
    const out = new Set<string>();
    for (let r = r1; r <= r2; r++) {
      const s = stus[r];
      if (!s) continue;
      for (let c = c1; c <= c2; c++) {
        const dk = dks[c];
        if (dk) out.add(`${s.id}|${dk}`);
      }
    }
    return out;
  }, [activeCell, selectionFocus, navStudents, dateKeysForNav]);

  // 범위 일괄 적용 — selectedKeys 의 모든 셀에 동일 값 (undo 기록 포함).
  const applyValueToSelection = useCallback(
    (value: number | null) => {
      if (selectedKeys.size === 0) return;
      for (const key of selectedKeys) {
        const sep = key.lastIndexOf("|");
        if (sep < 0) continue;
        const sid = key.slice(0, sep);
        const dk = key.slice(sep + 1);
        setCellValue(sid, dk, value);
      }
    },
    [selectedKeys, setCellValue]
  );

  /**
   * 일자 컬럼 폭 드래그 리사이즈 — thead 핸들 mousedown.
   *   document mousemove → 새 폭 계산 → onColumnResize.
   */
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!onColumnResize) return;
      e.preventDefault();
      e.stopPropagation();
      resizingRef.current = { startX: e.clientX, startWidth: cellWidthPx };
      setIsResizing(true);
    },
    [cellWidthPx, onColumnResize]
  );

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (e: MouseEvent) => {
      const r = resizingRef.current;
      if (!r) return;
      const delta = e.clientX - r.startX;
      onColumnResize?.(r.startWidth + delta);
    };
    const onUp = () => {
      resizingRef.current = null;
      setIsResizing(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    // 드래그 중 텍스트 선택/cursor 변경
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizing, onColumnResize]);

  /**
   * 드래그 채우기 시작 — 활성 셀 우하단 핸들 mousedown 콜백.
   *   시작 시점 활성 셀 값 보존 + isDragFilling=true.
   *   document mousemove 가 selectionFocus 갱신, mouseup 이 commit.
   */
  const handleDragFillStart = useCallback(() => {
    if (!activeCell) return;
    const s = studentsRef.current.find((x) => x.id === activeCell.studentId);
    const v = s?.attendance?.[activeCell.dateKey];
    dragFillStartValueRef.current = typeof v === "number" ? v : null;
    setIsDragFilling(true);
    setSelectionFocus(null); // 드래그 시작 시 single cell 부터
  }, [activeCell]);

  // 드래그 채우기 — document level mousemove/mouseup.
  //   elementFromPoint 로 hover 중인 셀 추출 → data-cell-key → selectionFocus.
  useEffect(() => {
    if (!isDragFilling) return;
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as
        | HTMLElement
        | null;
      if (!el) return;
      // td 또는 자식 안에서 가장 가까운 data-cell-key 찾기
      const cellEl = el.closest<HTMLElement>("[data-cell-key]");
      if (!cellEl) return;
      const key = cellEl.getAttribute("data-cell-key");
      if (!key) return;
      const sep = key.lastIndexOf("|");
      if (sep < 0) return;
      const sid = key.slice(0, sep);
      const dk = key.slice(sep + 1);
      setSelectionFocus({ studentId: sid, dateKey: dk });
    };
    const onUp = () => {
      // commit — selection 영역 전체에 시작값 채우기
      if (selectedKeys.size >= 1) {
        applyValueToSelection(dragFillStartValueRef.current);
      }
      setIsDragFilling(false);
      setSelectionFocus(null);
      dragFillStartValueRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [isDragFilling, selectedKeys, applyValueToSelection]);

  // 학생 ID → 그 학생 행에서 선택된 dateKey set (StudentRow 에 직접 prop 전달용).
  //   selectedKeys 전체를 매번 prop drill 하면 모든 행 re-render 됨 →
  //   per-student 분할 후 동일 student ID 행만 변경된 set 받도록.
  const selectedByStudent = useMemo<Map<string, Set<string>>>(() => {
    const m = new Map<string, Set<string>>();
    if (selectedKeys.size <= 1) return m;
    for (const key of selectedKeys) {
      const sep = key.lastIndexOf("|");
      if (sep < 0) continue;
      const sid = key.slice(0, sep);
      const dk = key.slice(sep + 1);
      let s = m.get(sid);
      if (!s) {
        s = new Set();
        m.set(sid, s);
      }
      s.add(dk);
    }
    return m;
  }, [selectedKeys]);

  // 활성 셀이 화면 밖이면 자동 스크롤
  useEffect(() => {
    if (!activeCell) return;
    const el = document.querySelector<HTMLElement>(
      `[data-cell-key="${activeCell.studentId}|${activeCell.dateKey}"]`
    );
    if (el) {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeCell]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 활성 셀이 없으면 무시
      if (!activeCell) return;
      // 컨텍스트 메뉴(메모/색상 등) 열려 있으면 무시
      if (contextMenu) return;
      // 입력/textarea/contenteditable 에 포커스되어 있으면 무시
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;

      // Ctrl/Cmd + Z → undo (버퍼 입력 중에도 즉시 동작)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        setCellInput(null);
        const last = undoStackRef.current.pop();
        if (last) {
          onAttendanceChangeRef.current(
            last.studentId,
            last.dateKey,
            last.oldValue
          );
          setActiveCell({ studentId: last.studentId, dateKey: last.dateKey });
        }
        return;
      }

      // Ctrl/Cmd + C → 활성 셀 값 복사 (앱 내부 버퍼)
      //   시트의 Ctrl+C 와 동등 — 복사된 셀은 점선 테두리로 표시.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        // 입력 버퍼 중이면 무시 (사용자가 텍스트 선택해 복사하려는 의도일 수 있음)
        if (cellInput !== null) return;
        const s = studentsRef.current.find(
          (x) => x.id === activeCell.studentId
        );
        const v = s?.attendance?.[activeCell.dateKey];
        const value = typeof v === "number" ? v : null;
        clipboardCellRef.current = { value };
        setCopiedCellKey(`${activeCell.studentId}|${activeCell.dateKey}`);
        return;
      }

      // Ctrl/Cmd + V → 클립보드 값을 활성 셀에 붙여넣기
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        e.preventDefault();
        if (cellInput !== null) setCellInput(null);
        const clip = clipboardCellRef.current;
        if (clip === null) return;
        setCellValue(activeCell.studentId, activeCell.dateKey, clip.value);
        return;
      }

      const moveActive = (dx: number, dy: number) => {
        const stus = visibleStudentsRef.current;
        const dks = dateKeysRef.current;
        const row = stus.findIndex((s) => s.id === activeCell.studentId);
        const col = dks.indexOf(activeCell.dateKey);
        if (row < 0 || col < 0) return;
        const newRow = Math.max(0, Math.min(stus.length - 1, row + dy));
        const newCol = Math.max(0, Math.min(dks.length - 1, col + dx));
        const ns = stus[newRow];
        const nk = dks[newCol];
        if (ns && nk) {
          setActiveCell({ studentId: ns.id, dateKey: nk });
          setSelectionFocus(null); // 일반 이동 → 범위 해제
        }
      };

      // Shift + 방향키 — anchor 유지, focus 만 이동 (범위 확장).
      //   anchor 는 activeCell, focus 는 selectionFocus 또는 anchor.
      const extendFocus = (dx: number, dy: number) => {
        const stus = visibleStudentsRef.current;
        const dks = dateKeysRef.current;
        const cur = selectionFocus || activeCell;
        const row = stus.findIndex((s) => s.id === cur.studentId);
        const col = dks.indexOf(cur.dateKey);
        if (row < 0 || col < 0) return;
        const newRow = Math.max(0, Math.min(stus.length - 1, row + dy));
        const newCol = Math.max(0, Math.min(dks.length - 1, col + dx));
        const ns = stus[newRow];
        const nk = dks[newCol];
        if (ns && nk) setSelectionFocus({ studentId: ns.id, dateKey: nk });
      };

      // 버퍼 커밋: 현재 cellInput 을 파싱해 셀에 저장. 빈/잘못된 값이면 noop.
      //   범위 선택이 다중이면 모든 셀에 동일 값 적용 (시트 Ctrl+Enter 와 동등).
      const commitBuffer = () => {
        if (cellInput === null) return;
        const trimmed = cellInput.trim();
        setCellInput(null);
        if (trimmed === "" || trimmed === ".") return;
        const n = Number(trimmed);
        if (isNaN(n)) return;
        if (selectedKeys.size > 1) {
          applyValueToSelection(n);
        } else {
          setCellValue(activeCell.studentId, activeCell.dateKey, n);
        }
      };

      // 숫자 / 소수점 — 버퍼 누적
      const isDigit = e.key >= "0" && e.key <= "9";
      const isDot = e.key === "." || e.key === ",";
      if (isDigit || isDot) {
        e.preventDefault();
        // 두 번째 . 은 무시 (1.5.5 같은 잘못된 입력 방지)
        if (isDot && cellInput !== null && cellInput.includes(".")) return;
        // ',' 는 '.' 으로 정규화 (한국 키보드 일부에서 . 입력 어려운 환경 대비)
        const ch = isDot ? "." : e.key;
        setCellInput((prev) => (prev === null ? ch : prev + ch));
        return;
      }

      // Backspace / Delete
      //   - 버퍼 입력 중이면 마지막 글자 제거 (빈 문자열이 되면 null 로)
      //   - 입력 중이 아니면 셀 값 초기화 (범위 선택 시 모든 셀)
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        if (cellInput !== null) {
          setCellInput((prev) => {
            if (prev === null) return null;
            const next = prev.slice(0, -1);
            return next.length === 0 ? null : next;
          });
        } else if (selectedKeys.size > 1) {
          applyValueToSelection(null);
        } else {
          setCellValue(activeCell.studentId, activeCell.dateKey, null);
        }
        return;
      }

      // 방향키 / Tab / Enter — 버퍼 있으면 커밋 후 이동.
      //   Shift+방향키 → focus 만 이동 (범위 확장, 시트와 동일).
      //   Tab/Enter 의 Shift 는 역방향 이동 의미라 범위 확장에 사용 안 함.
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) {
          extendFocus(-1, 0);
        } else {
          commitBuffer();
          moveActive(-1, 0);
        }
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) {
          extendFocus(1, 0);
        } else {
          commitBuffer();
          moveActive(1, 0);
        }
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        if (e.shiftKey) {
          extendFocus(0, -1);
        } else {
          commitBuffer();
          moveActive(0, -1);
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (e.shiftKey) {
          extendFocus(0, 1);
        } else {
          commitBuffer();
          moveActive(0, 1);
        }
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        commitBuffer();
        moveActive(e.shiftKey ? -1 : 1, 0);
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        // Ctrl+Enter — 범위 선택 시 anchor 값을 전체에 복사 (시트 패턴).
        if ((e.ctrlKey || e.metaKey) && selectedKeys.size > 1 && cellInput === null) {
          const s = studentsRef.current.find(
            (x) => x.id === activeCell.studentId
          );
          const v = s?.attendance?.[activeCell.dateKey];
          applyValueToSelection(typeof v === "number" ? v : null);
          return;
        }
        commitBuffer();
        moveActive(0, e.shiftKey ? -1 : 1);
        return;
      }
      // Esc — 버퍼 → 복사 → 범위 선택 → 활성 셀 순으로 해제.
      if (e.key === "Escape") {
        e.preventDefault();
        if (cellInput !== null) {
          setCellInput(null);
        } else if (copiedCellKey !== null) {
          setCopiedCellKey(null);
        } else if (selectionFocus !== null) {
          setSelectionFocus(null);
        } else {
          setActiveCell(null);
        }
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [
    activeCell,
    contextMenu,
    setCellValue,
    cellInput,
    copiedCellKey,
    selectionFocus,
    selectedKeys,
    applyValueToSelection,
  ]);

  // 고정 컬럼 수 계산
  // 기본: #, 이름, 학교, 요일 (4) + 출석, 등록 (2) = 6
  // 옵션: 예정액 / 수납액 / 실급여
  const optionalCols =
    (showExpectedBilling ? 1 : 0) +
    (showPaidAmount ? 1 : 0) +
    (showActualSalary ? 1 : 0);
  const fixedColCount = 4 + optionalCols + 2;

  // 과목별 단위: 영어는 U(유닛), 나머지는 T(타임)
  const unit: "U" | "T" = subject === "english" ? "U" : "T";

  if (visibleStudents.length === 0) {
    const hasSearch = !!(studentSearch && studentSearch.trim().length > 0);
    return (
      <div className="flex flex-col items-center justify-center h-64 text-zinc-400 text-sm gap-1">
        {hasSearch ? (
          <>
            <span>
              &ldquo;{studentSearch}&rdquo; 검색 결과 없음.
            </span>
            <span className="text-xs">
              상단의 검색창에서 ✕ 를 눌러 검색어를 지우면 전체 학생이 다시 보입니다.
            </span>
          </>
        ) : (
          <span>표시할 학생이 없습니다.</span>
        )}
      </div>
    );
  }

  // 렌더링 행 구성
  const renderRows = () => {
    if (sortMode === "name" || sortMode === "day") {
      const DAY_ORDER_IDX = ["월", "화", "수", "목", "금", "토", "일"];
      const getFirstDayIdx = (s: Student): number => {
        if (!s.days || s.days.length === 0) return 999;
        const sorted = [...s.days].sort(
          (a, b) => DAY_ORDER_IDX.indexOf(a) - DAY_ORDER_IDX.indexOf(b)
        );
        return DAY_ORDER_IDX.indexOf(sorted[0]);
      };
      const sorted = [...visibleStudents].sort((a, b) => {
        if (sortMode === "day") {
          const diff = getFirstDayIdx(a) - getFirstDayIdx(b);
          if (diff !== 0) return diff;
        }
        return a.name.localeCompare(b.name, "ko");
      });
      return sorted.map((student, idx) => (
        <StudentRow
          key={student.id}
          student={student}
          index={idx}
          dates={dates}
          year={year}
          month={month}
          salaryConfig={salaryConfig}
          tierOverrideId={tierOverrides?.[student.id]}
          highlightWeekends={highlightWeekends}
          showExpectedBilling={showExpectedBilling}
          showPaidAmount={showPaidAmount}
          showActualSalary={showActualSalary}
          paidAmount={paidAmountByStudent?.get(student.id)}
          actualSalary={actualSalaryByStudent?.get(student.id)}
          cellWidthPx={cellWidthPx}
          cellHeightPx={cellHeightPx}
          holidayDateSet={holidayDateSet}
          holidayNameMap={holidayNameMap}
          termCount={termCountMap?.get(student.id)}
          unit={unit}
          onHideStudent={onHideStudent}
          onCellClick={handleCellClick}
          onCellRightClick={handleCellRightClick}
          editingByPeers={editingByPeers}
          activeDateKey={
            activeCell?.studentId === student.id ? activeCell.dateKey : undefined
          }
          cellInputBuffer={
            activeCell?.studentId === student.id && cellInput !== null
              ? cellInput
              : undefined
          }
          onCellInputChange={handleCellInputChange}
          onCellInputAction={handleCellInputAction}
          onShowBreakdown={onShowBreakdown}
          onAddTier={onAddTier}
          copiedDateKey={
            copiedCellKey && copiedCellKey.startsWith(student.id + "|")
              ? copiedCellKey.slice(student.id.length + 1)
              : undefined
          }
          selectedDateKeys={selectedByStudent.get(student.id)}
          onDragFillStart={handleDragFillStart}
        />
      ));
    }

    // 수업별 그룹
    const groupMap = new Map<string, Student[]>();
    for (const s of visibleStudents) {
      const group = s.group || "미분류";
      if (!groupMap.has(group)) groupMap.set(group, []);
      groupMap.get(group)!.push(s);
    }

    const allGroups = Array.from(groupMap.keys());
    const orderedGroups = [
      ...groupOrder.filter((g) => allGroups.includes(g)),
      ...allGroups.filter((g) => !groupOrder.includes(g)),
    ];

    const elements: React.ReactNode[] = [];
    let globalIdx = 0;

    for (const group of orderedGroups) {
      const groupStudents = groupMap.get(group) || [];
      const isCollapsed = collapsedGroups.has(group);

      elements.push(
        <GroupHeader
          key={`group-${group}`}
          groupName={group}
          studentCount={groupStudents.length}
          isCollapsed={isCollapsed}
          onToggleCollapse={() => toggleCollapse(group)}
          onMoveUp={() => moveGroup(group, "up")}
          onMoveDown={() => moveGroup(group, "down")}
          colSpan={fixedColCount + dates.length}
        />
      );

      if (!isCollapsed) {
        const sorted = [...groupStudents].sort((a, b) => a.name.localeCompare(b.name, "ko"));
        let prevRealId: string | null = null;
        for (const student of sorted) {
          const realId = (student.id || "").split("|")[0];
          const hideIdentity = realId === prevRealId;
          prevRealId = realId;
          elements.push(
            <StudentRow
              key={student.id}
              student={student}
              index={globalIdx}
              dates={dates}
              year={year}
              month={month}
              salaryConfig={salaryConfig}
              tierOverrideId={tierOverrides?.[student.id]}
              highlightWeekends={highlightWeekends}
              showExpectedBilling={showExpectedBilling}
              showPaidAmount={showPaidAmount}
              showActualSalary={showActualSalary}
              paidAmount={paidAmountByStudent?.get(student.id)}
              actualSalary={actualSalaryByStudent?.get(student.id)}
              hideIdentity={hideIdentity}
              cellWidthPx={cellWidthPx}
              cellHeightPx={cellHeightPx}
              holidayDateSet={holidayDateSet}
              holidayNameMap={holidayNameMap}
              termCount={termCountMap?.get(student.id)}
              unit={unit}
              onHideStudent={onHideStudent}
              onCellClick={handleCellClick}
              onCellRightClick={handleCellRightClick}
              activeDateKey={
                activeCell?.studentId === student.id
                  ? activeCell.dateKey
                  : undefined
              }
              cellInputBuffer={
                activeCell?.studentId === student.id && cellInput !== null
                  ? cellInput
                  : undefined
              }
              onShowBreakdown={onShowBreakdown}
              onAddTier={onAddTier}
              copiedDateKey={
                copiedCellKey && copiedCellKey.startsWith(student.id + "|")
                  ? copiedCellKey.slice(student.id.length + 1)
                  : undefined
              }
              selectedDateKeys={selectedByStudent.get(student.id)}
            />
          );
          globalIdx++;
        }
      } else {
        globalIdx += groupStudents.length;
      }
    }

    return elements;
  };

  const contextStudent = contextMenu ? students.find((s) => s.id === contextMenu.studentId) : null;

  /**
   * 메모 자동완성 추천 (audit J).
   *   현재 표시 학생들의 모든 메모를 빈도순 정렬해 상위 추천.
   *   ContextMenu 가 열릴 때만 계산 (콘텍스트 메뉴 의존).
   */
  const memoSuggestions = useMemo<string[]>(() => {
    if (!contextMenu) return [];
    const counts = new Map<string, number>();
    for (const s of students) {
      const memos = s.memos || {};
      for (const m of Object.values(memos)) {
        if (!m) continue;
        const trimmed = m.trim();
        if (!trimmed) continue;
        counts.set(trimmed, (counts.get(trimmed) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => m);
  }, [contextMenu, students]);

  // 선택 범위 통계 — 카운트 (시트 G 에서 sum/avg 도 추가 예정).
  const selectionStats = useMemo(() => {
    if (selectedKeys.size <= 1) return null;
    let count = 0;
    let nonEmpty = 0;
    let sum = 0;
    let max = -Infinity;
    let min = Infinity;
    for (const key of selectedKeys) {
      const sep = key.lastIndexOf("|");
      if (sep < 0) continue;
      const sid = key.slice(0, sep);
      const dk = key.slice(sep + 1);
      const s = students.find((x) => x.id === sid);
      const v = s?.attendance?.[dk];
      count++;
      if (typeof v === "number") {
        nonEmpty++;
        sum += v;
        if (v > max) max = v;
        if (v < min) min = v;
      }
    }
    return {
      count,
      nonEmpty,
      sum,
      avg: nonEmpty > 0 ? sum / nonEmpty : 0,
      max: nonEmpty > 0 ? max : 0,
      min: nonEmpty > 0 ? min : 0,
    };
  }, [selectedKeys, students]);

  return (
    <>
      <table
        className="text-sm border-separate border-spacing-0 table-fixed [&_tbody_td]:border-b [&_tbody_td]:border-zinc-200 dark:[&_tbody_td]:border-zinc-700"
        style={{ width: "max-content" }}
      >
        <thead className="sticky top-0 z-[30]">
          <tr className="bg-zinc-800 text-white shadow-md">
            <th style={{ width: 32, minWidth: 32, maxWidth: 32 }} className="sticky left-0 z-[40] bg-zinc-800 px-1 py-2 text-center text-[12px] border-r border-zinc-600">#</th>
            <th style={{ width: 120, minWidth: 120, maxWidth: 120 }} className="sticky left-[32px] z-[40] bg-zinc-800 px-2 py-2 text-left text-[12px] border-r border-zinc-600">이름</th>
            <th style={{ width: 80, minWidth: 80, maxWidth: 80 }} className="sticky left-[152px] z-[40] bg-zinc-800 px-1 py-2 text-left text-[12px] border-r border-zinc-600">학교</th>
            <th className="bg-zinc-800 w-[140px] px-1 py-2 text-center text-[12px] border-r border-zinc-600">요일</th>
            {showExpectedBilling && (
              <th className="bg-zinc-800 w-[60px] px-1 py-2 text-center text-[12px] border-r border-zinc-600">예정액</th>
            )}
            {showPaidAmount && (
              <th
                className="bg-zinc-800 w-[70px] px-1 py-2 text-center text-[12px] border-r border-zinc-600"
                title="이번 달 실제 납부된 금액 합계"
              >
                수납액
              </th>
            )}
            {showActualSalary && (
              <th
                className="bg-zinc-800 w-[70px] px-1 py-2 text-center text-[12px] border-r border-zinc-600"
                title="상단 이번 달 급여와 동일 공식 (수납 캡 · 선생님 비율 · 블로그 패널티 반영)"
              >
                실급여
              </th>
            )}
            <th
              className="bg-zinc-800 w-[52px] px-1 py-2 text-center text-[12px] border-r border-zinc-600"
              title="등록차수 = 해당 월 담임 청구액 ÷ 학생 단가"
            >
              등록
            </th>
            <th
              className="bg-zinc-800 w-[52px] px-1 py-2 text-center text-[12px] border-r border-zinc-600"
            >
              출석
            </th>
            {dateInfos.map((info, i) => {
              const dateKey = formatDateKey(dates[i]);
              const holidayName = holidayNameMap?.get(dateKey);
              // 헤더 배경 우선순위: 오늘 > 공휴일 > 일요일 > 토요일 > 기본.
              //   본문 셀의 색상 정책과 시각적으로 매칭 — 운영자가 헤더만 봐도
              //   주말·휴일을 즉시 식별 가능 (audit #19).
              const headerBg = info.isToday
                ? "bg-blue-600"
                : holidayName
                  ? "bg-red-900/60"
                  : info.isSunday
                    ? "bg-red-950/40"
                    : info.isSaturday
                      ? "bg-blue-950/40"
                      : "";
              const dayLabelColor = holidayName
                ? "text-red-300"
                : info.isSunday
                  ? "text-red-300"
                  : info.isSaturday
                    ? "text-blue-300"
                    : "text-zinc-400";
              return (
                <th
                  key={i}
                  style={{ width: cellWidthPx, minWidth: cellWidthPx }}
                  title={holidayName ? `🎉 ${holidayName}` : undefined}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (confirm(`${info.date}일 열을 숨기시겠습니까?`)) {
                      onHideDate(dateKey);
                    }
                  }}
                  className={`relative px-0 py-1 text-center cursor-context-menu border-r border-zinc-600 ${headerBg}`}
                >
                  <div className={`text-[11px] ${dayLabelColor}`}>
                    {info.dayLabel}
                    {holidayName && (
                      <span className="ml-0.5 text-[9px] opacity-80">🎉</span>
                    )}
                  </div>
                  <div className="text-[13px] font-bold">{info.date}</div>
                  {/* 컬럼 폭 드래그 핸들 (audit H) — 헤더 우측 1px 영역, 호버 시 강조.
                      mousedown → 모든 일자 컬럼 동일 폭으로 갱신. */}
                  {onColumnResize && (
                    <span
                      role="separator"
                      aria-label="일자 컬럼 폭 조절"
                      title="드래그하여 일자 컬럼 폭 조절"
                      onMouseDown={handleResizeStart}
                      className="absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60"
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{renderRows()}</tbody>
        {(showExpectedBilling || showPaidAmount || showActualSalary) && (
          <SummaryFooter
            students={visibleStudents}
            showExpectedBilling={showExpectedBilling}
            showPaidAmount={showPaidAmount}
            showActualSalary={showActualSalary}
            paidAmountByStudent={paidAmountByStudent}
            actualSalaryByStudent={actualSalaryByStudent}
            datesCount={dates.length}
            cellWidthPx={cellWidthPx}
          />
        )}
      </table>

      {/* 컨텍스트 메뉴 — 메모/색상만 (숫자 입력은 키보드로 통일) */}
      {contextMenu && contextStudent && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          currentMemo={contextStudent.memos?.[contextMenu.dateKey]}
          currentColor={contextStudent.cellColors?.[contextMenu.dateKey]}
          onSaveMemo={(m) => onMemoChange(contextMenu.studentId, contextMenu.dateKey, m)}
          onSelectColor={(c) => onCellColorChange(contextMenu.studentId, contextMenu.dateKey, c)}
          onClose={() => setContextMenu(null)}
          memoSuggestions={memoSuggestions}
        />
      )}
      {/* 선택 범위 통계 — 시트 우하단 selection sum 대체 (audit G).
          selectedKeys.size > 1 일 때만 표시. fixed 위치, 사용자 입력 방해 X. */}
      {selectionStats && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-sm border border-blue-300 bg-white px-3 py-1.5 text-xs shadow-lg dark:border-blue-700 dark:bg-zinc-900">
          <span className="font-bold text-blue-700 dark:text-blue-300">
            🔢 선택 {selectionStats.count}셀
          </span>
          <span className="text-zinc-500">·</span>
          <span className="text-zinc-700 dark:text-zinc-300">
            <b>합계</b> {selectionStats.sum.toFixed(1)}
          </span>
          <span className="text-zinc-500">·</span>
          <span className="text-zinc-700 dark:text-zinc-300">
            <b>평균</b> {selectionStats.avg.toFixed(2)}
          </span>
          <span className="text-zinc-500">·</span>
          <span className="text-zinc-700 dark:text-zinc-300">
            값있음 {selectionStats.nonEmpty}
          </span>
          {selectionStats.nonEmpty > 0 && (
            <>
              <span className="text-zinc-500">·</span>
              <span className="text-[10px] text-zinc-500">
                min {selectionStats.min} / max {selectionStats.max}
              </span>
            </>
          )}
          <span className="ml-1 text-[10px] text-zinc-400">
            (숫자 입력 → 일괄 적용 · Esc 해제)
          </span>
        </div>
      )}
    </>
  );
}

/**
 * 합계행 — 옵션 컬럼(예정액/정산액/수납액/실급여)의 총합을 보여준다.
 * 상단 "이번 달 급여"와 실급여 합계가 일치하는지 한눈에 확인 가능.
 */
function SummaryFooter({
  students,
  showExpectedBilling,
  showPaidAmount,
  showActualSalary,
  paidAmountByStudent,
  actualSalaryByStudent,
  datesCount,
  cellWidthPx,
}: {
  students: Student[];
  showExpectedBilling: boolean;
  showPaidAmount: boolean;
  showActualSalary: boolean;
  paidAmountByStudent?: Map<string, number>;
  actualSalaryByStudent?: Map<string, number>;
  datesCount: number;
  cellWidthPx: number;
}) {
  const totalPaid = useMemo(() => {
    if (!paidAmountByStudent) return 0;
    let sum = 0;
    for (const s of students) sum += paidAmountByStudent.get(s.id) ?? 0;
    return Math.floor(sum); // 합산 시 정수 내림
  }, [students, paidAmountByStudent]);

  const totalActual = useMemo(() => {
    if (!actualSalaryByStudent) return 0;
    let sum = 0;
    for (const s of students) sum += actualSalaryByStudent.get(s.id) ?? 0;
    return Math.floor(sum); // 합산 시 정수 내림
  }, [students, actualSalaryByStudent]);

  const sumCellClass =
    "sticky bottom-0 bg-zinc-100 px-1 py-2 text-right text-[12px] font-bold text-zinc-800 border-t-2 border-zinc-400 dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600";
  const labelCellClass =
    "sticky bottom-0 bg-zinc-100 px-2 py-2 text-[12px] font-bold text-zinc-700 border-t-2 border-zinc-400 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-600";
  const plainCellClass =
    "sticky bottom-0 bg-zinc-100 border-t-2 border-zinc-400 dark:bg-zinc-800 dark:border-zinc-600";

  return (
    <tfoot className="sticky bottom-0 z-[25]">
      <tr>
        {/* # (비워둠) */}
        <td className={`${plainCellClass} sticky left-0 z-[40]`} style={{ width: 32 }} />
        {/* 이름 = 합계 라벨 */}
        <td
          className={`${labelCellClass} sticky left-[32px] z-[40]`}
          style={{ width: 120 }}
          colSpan={2}
        >
          합계 (학생 {new Set(students.map((s) => (s.id || "").split("|")[0])).size}명)
        </td>
        {/* 요일 (비워둠) */}
        <td className={plainCellClass} />
        {/* 예정액 — 합계 미계산 (개별 셀에서만 표시) */}
        {showExpectedBilling && (
          <td className={sumCellClass} title="예정액 합계는 개별 셀 참고">
            —
          </td>
        )}
        {showPaidAmount && (
          <td className={sumCellClass}>
            {totalPaid > 0 ? totalPaid.toLocaleString() : "-"}
          </td>
        )}
        {showActualSalary && (
          <td
            className={sumCellClass}
            title="상단 '이번 달 급여'에서 인센티브 제외한 값과 일치해야 함"
          >
            {totalActual > 0 ? totalActual.toLocaleString() : "-"}
          </td>
        )}
        {/* 등록, 출석 (비워둠) */}
        <td className={plainCellClass} />
        <td className={plainCellClass} />
        {/* 날짜 열들 (비워둠) */}
        {Array.from({ length: datesCount }).map((_, i) => (
          <td key={i} className={plainCellClass} style={{ width: cellWidthPx }} />
        ))}
      </tr>
    </tfoot>
  );
}
