import { NextResponse } from "next/server";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import type { Student, Enrollment } from "@/types";

/**
 * GET /api/students
 * 학생 전체 조회 (active / withdrawn 상태) + enrollments subcollection 병렬 로드
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

    return NextResponse.json(withEnrollments);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 }
    );
  }
}
