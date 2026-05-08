import { NextResponse } from "next/server";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import type { Student, Enrollment } from "@/types";

/**
 * GET /api/students
 * 학생 전체 조회 (active / withdrawn 상태) + enrollments subcollection 병렬 로드.
 *
 * 추가로, Supabase `virtual_students` (시트에만 있고 Firebase 미등록) 도 합쳐 반환한다.
 * 동명이인 충돌 방지: Firebase 쪽에 이미 같은 이름이 있으면 virtual 은 제외.
 */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  try {
    const q = query(
      collection(db, "students"),
      where("status", "in", ["active", "withdrawn"])
    );

    // 학생 메타 + virtual_students 를 병렬 fetch (audit v5 #2).
    //   기존: getDocs(students) 후 → virtual fetch (직렬). virtual 이 Firebase 끝날 때까지 대기.
    //   변경: 둘 다 동시에 시작. 학생별 enrollments 는 어차피 Firebase 결과 필요해서 그 다음.
    const [snap, virtualResult] = await Promise.all([
      getDocs(q),
      supabase.from("virtual_students").select("*"),
    ]);
    const virtualRows = virtualResult.data;

    const studentDocs = snap.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<Student, "id">),
    }));

    const withEnrollments = await Promise.all(
      studentDocs.map(async (student) => {
        const enrollSnap = await getDocs(
          collection(db, "students", student.id, "enrollments")
        );
        const enrollments: Enrollment[] = enrollSnap.docs.map((eDoc) => {
          const d = eDoc.data();
          return {
            subject: d.subject || "",
            classId: d.classId || "",
            className: d.className || "",
            staffId: d.staffId || "",
            teacher: d.teacher || "",
            days: d.days || [],
            schedule: d.schedule || [],
            startDate: d.startDate || "",
            endDate: d.endDate || "",
            onHold: d.onHold || false,
          };
        });

        return { ...student, enrollments };
      })
    );

    const firebaseTeachersByKey = new Map<string, Set<string>>();
    for (const s of withEnrollments) {
      const key = `${s.name}|${s.school || ""}`;
      const set = firebaseTeachersByKey.get(key) || new Set<string>();
      for (const e of s.enrollments || []) {
        if (e.teacher) set.add(e.teacher);
        if (e.staffId) set.add(e.staffId);
      }
      firebaseTeachersByKey.set(key, set);
    }

    const virtualStudents: Student[] = (virtualRows || [])
      .filter((v) => {
        const key = `${v.name}|${v.school || ""}`;
        const fbTeachers = firebaseTeachersByKey.get(key);
        if (fbTeachers && fbTeachers.has(v.teacher_staff_id)) return false;
        return true;
      })
      .map((v) => {
        const enrollment: Enrollment = {
          subject: v.subject || "math",
          classId: "",
          className: v.class_name || "",
          staffId: v.teacher_staff_id || "",
          teacher: v.teacher_staff_id || "",
          days: Array.isArray(v.days) ? v.days : [],
          schedule: [],
          // startDate 비워두면 isDateValidForStudent 에서 무제한 유효
          startDate: "",
          endDate: "",
          onHold: false,
        };
        return {
          id: v.id,
          name: v.name,
          school: v.school || "",
          grade: v.grade || "",
          group: v.class_name || "",
          enrollments: [enrollment],
          startDate: "",
          endDate: "",
          attendance: {},
          memos: {},
          homework: {},
          cellColors: {},
        } as Student;
      });

    return NextResponse.json([...withEnrollments, ...virtualStudents]);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 }
    );
  }
}
