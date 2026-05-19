"use client";

import { useCallback, useEffect, useState } from "react";
import type { TeacherBlogPost } from "./useTeacherBlogPosts";

/**
 * 특정 월의 모든 선생님 블로그 작성 기록 조회 (정산 패널티 판정용)
 */
export function useAllBlogPosts(year: number, month: number) {
  const [posts, setPosts] = useState<TeacherBlogPost[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        year: String(year),
        month: String(month),
      });
      const res = await fetch(`/api/teacher-blog-posts?${params}`, { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as TeacherBlogPost[];
        setPosts(data);
      }
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  /** 특정 선생님이 해당 월에 블로그를 작성했는지 여부 */
  const hasPostForTeacher = useCallback(
    (teacherId: string): boolean => {
      const p = posts.find((p) => p.teacher_id === teacherId);
      return !!(p && Array.isArray(p.dates) && p.dates.length > 0);
    },
    [posts]
  );

  /**
   * 특정 선생님의 이번 달 블로그 작성 일자 저장 (upsert).
   * 실패 시 throw — 호출 측에서 에러를 표시.
   */
  const savePost = useCallback(
    async (teacherId: string, dates: string[], note: string = "") => {
      const res = await fetch("/api/teacher-blog-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacher_id: teacherId, year, month, dates, note }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(body?.error || `저장 실패 (HTTP ${res.status})`);
      }
      const row = (await res.json()) as TeacherBlogPost;
      setPosts((prev) => {
        const idx = prev.findIndex((p) => p.teacher_id === teacherId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = row;
          return next;
        }
        return [...prev, row];
      });
    },
    [year, month]
  );

  return { posts, loading, hasPostForTeacher, savePost, refetch: fetchPosts };
}
