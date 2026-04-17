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
    const snap = await getDocs(q);

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

    // virtual_students 도 합쳐서 반환.
    // 중복 판정은 이름+학교+선생님 조합 기준: Firebase 에 같은 학생이 이미 같은 선생님 담당으로
    // 있으면 virtual 불필요. Firebase 에 다른 선생님 담당으로만 있으면 virtual 은 "이 선생님 담당" 가상 레코드로 유지.
    const { data: virtualRows } = await supabase
      .from("virtual_students")
      .select("*");

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
