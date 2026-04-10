import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireAuth, requireAdmin } from "@/lib/apiAuth";

/**
 * data.go.kr 특일정보 API — 진짜 쉬는날만 (국경일 + 공휴일 + 대체공휴일)
 * 절기/잡절 제외를 위해 getRestDeInfo 가 아니라 getHoliDeInfo 사용.
 * @see https://www.data.go.kr/data/15012690/openapi.do
 */
const API_BASE =
  "http://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getHoliDeInfo";

interface HolidayRow {
  date: string; // YYYY-MM-DD
  year: number;
  name: string;
}

interface DataGoKrItem {
  dateKind?: string;
  dateName?: string;
  isHoliday?: string; // "Y" | "N"
  locdate?: number | string; // 20260101
  seq?: number;
}

function locdateToDateString(locdate: number | string): string {
  const s = String(locdate);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

async function fetchYearFromDataGoKr(year: number): Promise<HolidayRow[]> {
  const key = process.env.DATA_GO_KR_HOLIDAY_KEY;
  if (!key) {
    throw new Error("DATA_GO_KR_HOLIDAY_KEY 환경변수가 설정되지 않았습니다");
  }

  const rows: HolidayRow[] = [];

  for (let m = 1; m <= 12; m++) {
    const params = new URLSearchParams({
      serviceKey: key,
      solYear: String(year),
      solMonth: String(m).padStart(2, "0"),
      numOfRows: "50",
      _type: "json",
    });
    const url = `${API_BASE}?${params.toString()}`;

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`data.go.kr 호출 실패 (${year}-${m}): HTTP ${res.status}`);
    }
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      // 키 미등록/쿼터 초과 시 XML 에러 응답이 올 수 있음
      throw new Error(`data.go.kr 응답 파싱 실패: ${text.slice(0, 200)}`);
    }

    const body = (json as { response?: { body?: { items?: unknown; totalCount?: number } } })
      ?.response?.body;
    if (!body || !body.totalCount) continue;

    // items 은 단일/배열 혼재 → 정규화
    const itemsRaw = (body.items as { item?: DataGoKrItem | DataGoKrItem[] } | string | undefined);
    if (!itemsRaw || typeof itemsRaw === "string") continue;
    const itemField = itemsRaw.item;
    const items: DataGoKrItem[] = Array.isArray(itemField)
      ? itemField
      : itemField
      ? [itemField]
      : [];

    for (const it of items) {
      // getHoliDeInfo 는 원래 공휴일만 반환하지만 방어적으로 isHoliday === "Y" 만 저장
      if (it.isHoliday !== "Y") continue;
      if (!it.locdate || !it.dateName) continue;
      rows.push({
        date: locdateToDateString(it.locdate),
        year,
        name: String(it.dateName),
      });
    }
  }

  return rows;
}

/**
 * GET /api/holidays?year=2026
 * Supabase 캐시 우선, 없으면 data.go.kr 호출 후 캐싱
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  if (!year || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "year 파라미터 필요" }, { status: 400 });
  }

  // 캐시 조회
  const { data: cached, error: selErr } = await supabase
    .from("holidays")
    .select("date, name")
    .eq("year", year)
    .order("date", { ascending: true });
  if (selErr) return NextResponse.json({ error: selErr.message }, { status: 500 });

  if (cached && cached.length > 0) {
    return NextResponse.json(cached);
  }

  // 캐시 미스 → data.go.kr 호출
  try {
    const rows = await fetchYearFromDataGoKr(year);
    if (rows.length === 0) {
      return NextResponse.json([]);
    }
    const { error: upErr } = await supabase
      .from("holidays")
      .upsert(rows, { onConflict: "date" });
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    return NextResponse.json(rows.map((r) => ({ date: r.date, name: r.name })));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "공휴일 조회 실패" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/holidays?year=2026
 * 강제 재동기화 — 관리자만. 해당 연도를 data.go.kr 에서 다시 받아 덮어쓴다.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  if (!year || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "year 파라미터 필요" }, { status: 400 });
  }

  try {
    const rows = await fetchYearFromDataGoKr(year);
    // 해당 연도 기존 데이터 삭제 후 재삽입 (대체공휴일 변경 대응)
    const { error: delErr } = await supabase.from("holidays").delete().eq("year", year);
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from("holidays").insert(rows);
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    return NextResponse.json({ count: rows.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "공휴일 동기화 실패" },
      { status: 500 }
    );
  }
}
