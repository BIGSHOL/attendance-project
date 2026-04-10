import { NextResponse } from "next/server";
import { doc, getDoc, collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import type { Student, Enrollment } from "@/types";

/**
 * GET /api/students/[id]
 * 단일 학생 + enrollments 조회
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;

  try {
    const snap = await getDoc(doc(db, "students", id));
    if (!snap.exists()) {
      return NextResponse.json({ error: "학생 문서 없음" }, { status: 404 });
    }

    const enrollSnap = await getDocs(collection(db, "students", id, "enrollments"));
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

    const student: Student = {
      id,
      ...(snap.data() as Omit<Student, "id">),
      enrollments,
    };

    return NextResponse.json(student);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "조회 실패" },
      { status: 500 }
    );
  }
}
