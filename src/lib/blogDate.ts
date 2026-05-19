/**
 * 블로그 작성 일자 토큰 ↔ ISO(YYYY-MM-DD) 변환.
 *
 * 선생님 상세 / 블로그 일괄 관리 두 화면이 공용으로 사용. 입력은 "일(日) 단독" 을
 * 기본으로 받되, 지각 작성(다른 월에 적는 경우) 을 위해 "M/D" · "YYYY-MM-DD" 도 허용.
 * 두 화면이 같은 로직을 쓰도록 한 곳에 모음 — 매칭 규칙이 갈라지면 패널티 판정이 어긋남.
 */

/**
 * 토큰 → ISO(YYYY-MM-DD) 변환. invalid 한 토큰은 null.
 *   허용 포맷:
 *     "15"           → 기준 연·월 + 15일
 *     "5/3", "5.3"   → 기준 연 + 5월 3일 (지각 작성용)
 *     "2026-05-03"   → 그대로
 *     "2026/5/3"     → 정규화해서 그대로
 */
export function parseBlogToken(
  raw: string,
  year: number,
  month: number
): string | null {
  const s = raw.trim();
  if (!s) return null;
  let y = year,
    mo = month,
    d: number;
  // YYYY-MM-DD 또는 YYYY/MM/DD
  const full = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (full) {
    y = parseInt(full[1], 10);
    mo = parseInt(full[2], 10);
    d = parseInt(full[3], 10);
  } else {
    // M/D 또는 M.D
    const md = s.match(/^(\d{1,2})[/.](\d{1,2})$/);
    if (md) {
      mo = parseInt(md[1], 10);
      d = parseInt(md[2], 10);
    } else {
      // 일(日) 단독
      const dayOnly = s.match(/^(\d{1,2})$/);
      if (!dayOnly) return null;
      d = parseInt(dayOnly[1], 10);
    }
  }
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d))
    return null;
  if (mo < 1 || mo > 12) return null;
  const lastDay = new Date(y, mo, 0).getDate();
  if (d < 1 || d > lastDay) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * 입력 문자열(쉼표·공백 구분) → 정렬·중복 제거된 ISO 배열.
 * invalid 토큰은 조용히 버림.
 */
export function parseBlogDatesInput(
  input: string,
  year: number,
  month: number
): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,\s]+/)
        .map((t) => parseBlogToken(t, year, month))
        .filter((iso): iso is string => !!iso)
    )
  ).sort();
}

/**
 * ISO → 표시/편집용 토큰.
 *   - 기준 연·월   → "D"
 *   - 기준 연·다른 월 → "M/D"  (지각 작성: 4월 블로그를 5월에 적은 경우)
 *   - 다른 연도    → "YYYY-MM-DD"
 */
export function formatBlogDate(
  iso: string,
  year: number,
  month: number
): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  const y = parseInt(m[1], 10),
    mo = parseInt(m[2], 10),
    d = parseInt(m[3], 10);
  if (y === year && mo === month) return String(d);
  if (y === year) return `${mo}/${d}`;
  return iso;
}

/**
 * 표시용 라벨 — 순수 일(日) 토큰이면 "일" 접미사를 붙임 ("7" → "7일").
 * "M/D"·"YYYY-MM-DD" 토큰은 그대로.
 */
export function formatBlogDateLabel(
  iso: string,
  year: number,
  month: number
): string {
  const tok = formatBlogDate(iso, year, month);
  return /^\d+$/.test(tok) ? `${tok}일` : tok;
}
