"use client";

import { useState } from "react";

/**
 * 출석부 앱 사용 가이드.
 *   섹션별 펼침/접힘 — 자주 보는 항목만 펼쳐서 보기 편하게.
 *   시트 워크플로우와 매핑되는 부분은 명시 (시트의 N6 = 앱의 ℹ 버튼 등).
 */
type Section = {
  id: string;
  title: string;
  icon: string;
  body: React.ReactNode;
};

const SECTIONS: Section[] = [
  {
    id: "intro",
    title: "이 앱은 무엇인가요?",
    icon: "👋",
    body: (
      <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          학원의 <b>출석부 + 급여 정산</b>을 한 화면에서 관리하는 앱입니다.
          기존 Google Sheets 운영을 대체하면서, 시트의 핵심 공식·워크플로우는
          그대로 유지합니다.
        </p>
        <ul className="list-disc list-inside pl-2 space-y-0.5">
          <li>출석 입력은 시트와 동일하게 숫자만 입력 (예: <code className="font-mono">1</code>, <code className="font-mono">0.5</code>, <code className="font-mono">1.5</code>)</li>
          <li>정산 공식 = 시트 N6 수식 (1회당 단가 × 정산시수 × 0.911 × 비율%)</li>
          <li>등록차수·블로그 의무·tier 매칭도 시트와 1:1 매핑</li>
        </ul>
      </div>
    ),
  },
  {
    id: "attendance-input",
    title: "출석 입력",
    icon: "✏️",
    body: (
      <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <p className="font-semibold">키보드 (권장 — 시트의 셀 선택과 동일)</p>
        <ol className="list-decimal list-inside pl-2 space-y-1">
          <li>셀을 클릭하면 <b>파란 깜빡이는 테두리</b>가 표시됩니다 (활성 셀)</li>
          <li>숫자 / 소수점 키 (<code className="font-mono">0~9</code>, <code className="font-mono">.</code>) 를 누르면 입력 모드 진입</li>
          <li><kbd>Enter</kbd>·<kbd>Tab</kbd>·방향키로 다음 셀로 이동하면서 자동 저장</li>
          <li><kbd>Esc</kbd> 로 입력 취소, <kbd>Backspace</kbd> 로 셀 비우기</li>
          <li><kbd>Ctrl+Z</kbd> 로 마지막 변경 50개까지 Undo</li>
        </ol>
        <p className="font-semibold mt-3">우클릭 (메모/색상)</p>
        <ul className="list-disc list-inside pl-2 space-y-0.5">
          <li>셀 우클릭 → 메모 또는 셀 색상 지정 (자주 쓴 메모 자동완성 chip)</li>
          <li>학생 행 # 우클릭 → 해당 학생 숨김 (정산 영향 없음)</li>
          <li>날짜 헤더 우클릭 → 해당 일자 열 숨김</li>
        </ul>
      </div>
    ),
  },
  {
    id: "spreadsheet-features",
    title: "시트 같은 편의 기능",
    icon: "📋",
    body: (
      <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          Google Sheets 의 핵심 단축키·동작을 그대로 가져왔습니다.
        </p>
        <ul className="list-disc list-inside pl-2 space-y-1">
          <li>
            <b>복사/붙여넣기</b> — 활성 셀에서 <kbd>Ctrl+C</kbd> →
            다른 셀로 이동 → <kbd>Ctrl+V</kbd> (복사된 셀은 점선 테두리)
          </li>
          <li>
            <b>범위 선택</b> — <kbd>Shift</kbd>+클릭 또는 <kbd>Shift</kbd>+
            방향키로 사각 영역 선택 (반투명 파란)
          </li>
          <li>
            <b>일괄 입력</b> — 범위 선택 상태에서 숫자 입력 → 모든 셀에
            동일 값. <kbd>Backspace</kbd> 로 일괄 비우기. <kbd>Ctrl+Enter</kbd> 로 anchor 값 복사
          </li>
          <li>
            <b>드래그 채우기</b> — 활성 셀 우하단 작은 사각 → 드래그로
            옆 셀들 채우기
          </li>
          <li>
            <b>찾기/바꾸기</b> — <kbd>Ctrl+H</kbd> → 메모 일괄 검색·치환
            (대상 체크박스로 선택 가능)
          </li>
          <li>
            <b>선택 통계</b> — 범위 선택 시 우하단에 합계/평균/min/max/카운트 자동 표시
          </li>
          <li>
            <b>컬럼 폭 조절</b> — 일자 헤더 우측 가장자리 드래그
            (S/M/L 버튼은 자동 reset)
          </li>
        </ul>
        <p className="text-xs text-zinc-500 mt-2">
          학생/수납 페이지에서는 컬럼 헤더 클릭 → 정렬 + 깔때기 → 다중 필터.
        </p>
      </div>
    ),
  },
  {
    id: "search",
    title: "학생 빠른 검색",
    icon: "🔎",
    body: (
      <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          출석부 보기 옵션 줄에 <b>검색창</b>이 있습니다. 이름·학교·학년·반명을
          입력하면 즉시 좁혀집니다 (대소문자 무시). 검색어는 다음 방문 시에도
          유지됩니다.
        </p>
        <p className="text-xs text-zinc-500">
          검색은 <b>화면 표시</b>만 좁힐 뿐, 상단의 시수·실급여·등록차수
          계산은 전체 학생 기준으로 유지됩니다.
        </p>
      </div>
    ),
  },
  {
    id: "breakdown",
    title: "정산 계산 보는 법 (학생 ℹ 버튼)",
    icon: "🧮",
    body: (
      <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          학생 이름 옆 <b>ℹ</b> 버튼을 클릭하면 시트 N6 수식의 단계별 계산을 볼 수
          있습니다.
        </p>
        <ol className="list-decimal list-inside pl-2 space-y-0.5">
          <li>tier 매칭 (학생 → 단가)</li>
          <li>출석 시수 (날짜별 합계)</li>
          <li>등록차수 (청구액 ÷ 단가)</li>
          <li>정산 시수 = min(출석, 등록)</li>
          <li>1회당 선생님 몫 = 단가 × (1 − 8.9%) × 비율%</li>
          <li>학생 정산 = 4 × 5</li>
        </ol>
        <p className="text-xs text-zinc-500">
          모달 하단에 시트 N6 수식 그대로 표시되어, 시트와 비교 검증 가능.
        </p>
      </div>
    ),
  },
  {
    id: "sync",
    title: "시트 동기화 (관리자)",
    icon: "📄",
    body: (
      <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          선생님 시트 URL이 등록되어 있으면 출석부 상단의 <b>📄 동기화</b> 버튼이
          나타납니다. 클릭하면 시트의 해당 월 탭에서 출석값·메모·F열 tier가
          앱에 덮어씌워집니다.
        </p>
        <p className="font-semibold">전체 동기화 (정산 페이지)</p>
        <ul className="list-disc list-inside pl-2 space-y-0.5">
          <li>관리자가 등록된 모든 시트를 순차적으로 동기화</li>
          <li>일부 실패 시 모달 하단의 <b>↺ 실패만 다시</b> 로 재시도 가능</li>
          <li><b>📥 결과 다운로드</b> 로 timestamp 가 포함된 .txt 보관</li>
        </ul>
        <p className="text-xs text-amber-700 dark:text-amber-300">
          ⚠ 동기화는 시트 → 앱 단방향. 앱에서 수정한 출석값은 시트에 반영되지
          않습니다 (앱이 진실의 원천이 됨).
        </p>
      </div>
    ),
  },
  {
    id: "settlement",
    title: "정산 페이지 보는 법",
    icon: "💰",
    body: (
      <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          정산 페이지 상단에 <b>8개 KPI 카드</b>:
        </p>
        <ul className="list-disc list-inside pl-2 space-y-0.5">
          <li>선생님수 / 총 담당학생 / 총 출석 / 총 지급액</li>
          <li>비율제 (commission/mixed) 인원</li>
          <li>블로그 의무 작성/의무 비율</li>
          <li>블로그 패널티 (−2%) 적용 인원</li>
          <li>시트 등록 N/T (시트 URL 등록된 선생님 비율)</li>
        </ul>
        <p>
          탭 전환으로 <b>월별 정산</b> 또는 <b>시수 검증</b> (학생별 납부액 vs 수강
          시수 검증) 확인 가능.
        </p>
        <p className="font-semibold mt-2">엑셀 내보내기</p>
        <ul className="list-disc list-inside pl-2 space-y-0.5">
          <li>📥 엑셀 → 월별 정산 + 시수 검증 두 시트로 .xlsx 다운로드</li>
          <li>출석부 페이지에서도 동일 버튼으로 학생 × 일자 그리드 export</li>
        </ul>
      </div>
    ),
  },
  {
    id: "session",
    title: "월별 vs 세션별 보기",
    icon: "📅",
    body: (
      <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <p>출석부 우상단 토글로 두 가지 집계 방식을 선택할 수 있습니다.</p>
        <ul className="list-disc list-inside pl-2 space-y-1">
          <li>
            <b>월별</b> — 달력 월 1일 ~ 말일. "3월 급여는 3월 1~31일 분만"
            (대부분 사용)
          </li>
          <li>
            <b>세션별</b> — 학원 자체 정의 세션 기간. 예) 26.03 세션 = 3/6 ~ 4/2.
            세션 설정은 ⚙ 세션 (관리자) 에서.
          </li>
        </ul>
        <p className="text-xs text-zinc-500">
          두 뷰는 의도적으로 다른 값을 냅니다 — 사용자가 명시적으로 선택한
          기준에 따라 집계.
        </p>
      </div>
    ),
  },
  {
    id: "blog",
    title: "블로그 의무 / 패널티",
    icon: "📝",
    body: (
      <div className="space-y-2 text-sm text-zinc-700 dark:text-zinc-300">
        <p>
          블로그 의무가 있는 선생님이 해당 월에 블로그를 작성하지 않으면
          <b> 비율 −2% (최소 0%)</b> 패널티가 자동 적용됩니다.
        </p>
        <ul className="list-disc list-inside pl-2 space-y-0.5">
          <li>블로그 의무 토글: 선생님 상세 페이지에서 설정</li>
          <li>출석부 상단의 "블로그" 카드에 작성 일자 표시</li>
          <li>정산 페이지 행에 "블로그 −2%" 빨간 뱃지로 표시</li>
        </ul>
      </div>
    ),
  },
  {
    id: "faq",
    title: "자주 묻는 질문",
    icon: "❓",
    body: (
      <div className="space-y-3 text-sm text-zinc-700 dark:text-zinc-300">
        <Faq
          q="출석값을 잘못 입력했어요"
          a="셀 클릭 후 새 값 입력 → 자동 덮어쓰기. Ctrl+Z 로 50개까지 Undo 가능."
        />
        <Faq
          q="실급여가 0원으로 나와요"
          a="이번 달 수납 매칭이 안 되면 0 으로 처리됩니다. 학생의 수납 페이지에 해당 월 결제가 있는지, payment_name 이 학생 이름과 매칭되는지 확인."
        />
        <Faq
          q="등록차수와 출석이 다른데?"
          a="등록차수 (청구액 ÷ 단가) 보다 출석이 적으면 빨강(미달), 많으면 하늘색(보강) 으로 표시. 정산은 항상 min(등록, 출석) 기준."
        />
        <Faq
          q="시트와 값이 다른데?"
          a="학생 ℹ 버튼으로 단계별 breakdown 모달 열어 시트의 N6 수식과 비교. 단가/비율/수수료 중 하나가 다르면 보임."
        />
        <Faq
          q="신입/퇴원 학생 처리"
          a="해당 월에 startDate/endDate 가 걸치면 자동으로 신입/퇴원 뱃지. 정산은 재원 기간 내 출석만 집계."
        />
      </div>
    ),
  },
];

export default function HelpPage() {
  const [openId, setOpenId] = useState<string | null>(SECTIONS[0].id);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          📖 출석부 앱 가이드
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          기존 Google Sheets 의 "사용법" 탭을 대체하는 인앱 도움말. 섹션을
          클릭해서 펼쳐보세요.
        </p>
      </header>

      <ul className="space-y-2">
        {SECTIONS.map((s) => {
          const isOpen = openId === s.id;
          return (
            <li
              key={s.id}
              className="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            >
              <button
                type="button"
                onClick={() => setOpenId(isOpen ? null : s.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
              >
                <span className="flex items-center gap-2 text-sm font-bold text-zinc-900 dark:text-zinc-100">
                  <span>{s.icon}</span>
                  <span>{s.title}</span>
                </span>
                <span className="text-xs text-zinc-400">{isOpen ? "▼" : "▶"}</span>
              </button>
              {isOpen && (
                <div className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                  {s.body}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="mt-6 border-t border-zinc-200 pt-3 text-xs text-zinc-400 dark:border-zinc-800">
        문의 / 버그 제보는 운영자에게 직접 알려주세요.
      </footer>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div>
      <p className="font-semibold text-zinc-800 dark:text-zinc-200">Q. {q}</p>
      <p className="mt-0.5 pl-3 text-zinc-600 dark:text-zinc-400">A. {a}</p>
    </div>
  );
}
