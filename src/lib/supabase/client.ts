import { createBrowserClient } from "@supabase/ssr";

// 브라우저에서 Supabase 클라이언트는 싱글톤으로 공유
// (매 createClient() 호출 시 새 인스턴스를 만들면 realtime/auth 커넥션이 낭비됨)
let _client: ReturnType<typeof createBrowserClient> | null = null;

export function createClient() {
  if (_client) return _client;
  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return _client;
}
