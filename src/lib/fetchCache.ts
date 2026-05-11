/**
 * 모듈 레벨 인메모리 JSON fetch 캐시
 * - 동일 URL에 대한 동시 요청을 하나로 합침 (in-flight dedup)
 * - 마지막 성공 응답을 메모리에 보관해 페이지 전환 시 즉시 반환
 * - SWR 패턴: 캐시 있으면 먼저 반환하고 백그라운드 revalidate
 */

type CacheEntry<T> = { data: T; ts: number };

const cache = new Map<string, CacheEntry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export function getCached<T>(url: string): T | undefined {
  return cache.get(url)?.data as T | undefined;
}

/**
 * URL 기반 fetch — inflight dedup + 선택적 TTL cache.
 *
 * @param opts.ttlMs - cache 가 이 시간보다 fresh 하면 네트워크 호출 없이 cache 반환.
 *                    기본 0 (= cache 안 봄, SWR 동작). 같은 페이지의 여러 컴포넌트가
 *                    같은 URL fetch 시 중복 호출을 줄이려면 ttlMs 지정.
 */
export async function cachedFetch<T>(url: string, opts?: { ttlMs?: number }): Promise<T> {
  const ttlMs = opts?.ttlMs ?? 0;
  if (ttlMs > 0) {
    const entry = cache.get(url) as CacheEntry<T> | undefined;
    if (entry && Date.now() - entry.ts < ttlMs) {
      return entry.data;
    }
  }

  const existing = inflight.get(url);
  if (existing) return existing as Promise<T>;

  const p = (async () => {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as T;
    cache.set(url, { data, ts: Date.now() });
    return data;
  })()
    .finally(() => inflight.delete(url));

  inflight.set(url, p);
  return p;
}

export function invalidateCache(url: string) {
  cache.delete(url);
  inflight.delete(url);
}
