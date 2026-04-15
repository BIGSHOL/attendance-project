"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler<T> = (payload: RealtimePostgresChangesPayload<T & { [key: string]: any }>) => void;

interface Options {
  /** 채널 이름 — 동일 채널을 공유하려면 같은 값 사용 */
  channelName: string;
  /** Postgres 필터 (e.g. "teacher_id=eq.xxx") */
  filter?: string;
  enabled?: boolean;
}

/**
 * 특정 테이블의 INSERT/UPDATE/DELETE 이벤트를 구독.
 * 콜백은 ref 처럼 항상 최신을 보도록 useCallback 으로 안정화해서 넘기길 권장.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useRealtimeTable<T extends { [key: string]: any }>(
  table: string,
  onChange: Handler<T>,
  { channelName, filter, enabled = true }: Options
) {
  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    const channel = supabase.channel(channelName);

    channel.on(
      "postgres_changes" as never,
      { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
      (payload: RealtimePostgresChangesPayload<T>) => onChange(payload)
    );

    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, channelName, filter, enabled, onChange]);
}
