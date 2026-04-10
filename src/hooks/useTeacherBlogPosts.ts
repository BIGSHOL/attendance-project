"use client";

import { useCallback, useEffect, useState } from "react";

export interface TeacherBlogPost {
  id: string;
  teacher_id: string;
  year: number;
  month: number;
  dates: string[];  // ["2026-04-05", ...]
  note: string;
  created_at: string;
  updated_at: string;
}

/**
 * 특정 선생님의 블로그 작성 기록 (단일 월 또는 전체)
 * - teacherId 만 주면 해당 선생님의 모든 기록 로드
 * - year, month 주면 해당 월만 로드
 */
export function useTeacherBlogPosts(teacherId?: string, year?: number, month?: number) {
  const [posts, setPosts] = useState<TeacherBlogPost[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    if (!teacherId) {
      setPosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ teacher_id: teacherId });
      if (year !== undefined) params.set("year", String(year));
      if (month !== undefined) params.set("month", String(month));
      const res = await fetch(`/api/teacher-blog-posts?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as TeacherBlogPost[];
        setPosts(data);
      }
    } finally {
      setLoading(false);
    }
  }, [teacherId, year, month]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  /** 특정 월의 기록 업데이트 (upsert) */
  const savePost = useCallback(
    async (tid: string, y: number, m: number, dates: string[], note: string = "") => {
      const res = await fetch("/api/teacher-blog-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacher_id: tid, year: y, month: m, dates, note }),
      });
      if (!res.ok) return;
      const row = (await res.json()) as TeacherBlogPost;
      setPosts((prev) => {
        const idx = prev.findIndex(
          (p) => p.teacher_id === tid && p.year === y && p.month === m
        );
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = row;
          return next;
        }
        return [row, ...prev];
      });
    },
    []
  );

  /** 특정 월의 기록 조회 */
  const getPost = useCallback(
    (y: number, m: number): TeacherBlogPost | null => {
      return posts.find((p) => p.year === y && p.month === m) || null;
    },
    [posts]
  );

  /** 특정 월 블로그 작성 여부 (패널티 판정용) */
  const hasPostForMonth = useCallback(
    (y: number, m: number): boolean => {
      const p = posts.find((p) => p.year === y && p.month === m);
      return !!(p && Array.isArray(p.dates) && p.dates.length > 0);
    },
    [posts]
  );

  return { posts, loading, savePost, getPost, hasPostForMonth, refetch: fetchPosts };
}
