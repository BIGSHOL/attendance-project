import { NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase-admin";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/apiAuth";
import { normalizeSchool } from "@/lib/studentPaymentMatcher";
import type { Student, Enrollment } from "@/types";

/**
 * GET /api/students
 * 학생 전체 조회 (active / withdrawn 상태) + enrollments subcollection 병렬 로드.
 *
 * 추가로, Supabase `virtual_students` (시트에만 있고 Firebase 미등록) 도 합쳐 반환한다.
 * 동명이인 충돌 방지: Firebase 쪽에 이미 같은 이름이 있으면 virtual 은 제외.
 *
 * 학교 정규화: 모든 화면에서 같은 학생을 같은 학교로 보기 위해 응답 시점에 단축형
 * (`초/중/고/여중/여고`) 으로 통일. Firebase 원본 "대구일중학교" 등 풀네임 혼재 대응.
 */
export async function GET() {
  const supabase = await createClient();
  const auth = await requireAuth(supabase);
  if (!auth.ok) return auth.response;

  try {
    // Firebase Admin SDK 사용 — Firestore Rules 우회 (서비스 계정 인증).
    // 클라이언트 SDK 는 collectionGroup("enrollments") 에 별도 rule 필요해
    // 운영자 환경별로 권한 오류 발생. Admin SDK 는 rules 영향 없이 안정.
    const adb = getAdminDb();
    const studentsQuery = adb
      .collection("students")
      .where("status", "in", ["active", "withdrawn"]);

    // 학생 메타 + virtual_students + 모든 enrollments 를 한 번에 병렬 fetch (audit v5 #2 + #7).
    //
    //   기존: getDocs(students) → 503명 × getDocs(student/enrollments) loop = 504 RTT
    //   개선: getDocs(students) + getDocs(collectionGroup("enrollments")) + virtual = 3 병렬 호출
    //
    //   collectionGroup 은 모든 path 의 "enrollments" subcollection 을 평탄화. 503 RTT → 1 RTT.
    //   부모 doc 참조는 enrollSnap.ref.parent.parent (= students/{id}) 로 학생 ID 추출.
    const [snap, enrollAllSnap, virtualResult] = await Promise.all([
      studentsQuery.get(),
      adb.collectionGroup("enrollments").get(),
      supabase.from("virtual_students").select("*"),
    ]);
    const virtualRows = virtualResult.data;

    // 학생 ID 별 enrollments 그룹핑
    const enrollmentsByStudent = new Map<string, Enrollment[]>();
    for (const eDoc of enrollAllSnap.docs) {
      const studentId = eDoc.ref.parent.parent?.id;
      if (!studentId) continue;
      const d = eDoc.data();
      const enrollment: Enrollment = {
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
      const arr = enrollmentsByStudent.get(studentId) || [];
      arr.push(enrollment);
      enrollmentsByStudent.set(studentId, arr);
    }

    // school 정규화 적용
    const withEnrollments = snap.docs.map((doc) => {
      const data = doc.data() as Omit<Student, "id">;
      return {
        id: doc.id,
        ...data,
        school: normalizeSchool(data.school || ""),
        enrollments: enrollmentsByStudent.get(doc.id) || [],
      };
    });

    // virtual 학생의 학교명을 firebase 원본 학교명에 맞춤.
    //   시트 sync 가 virtual 학생을 만들 때 학교명 표기가 firebase 와 다른 경우 (예:
    //   firebase="대구제일고" / virtual="제일고" / virtual2="") 있어, 단순 정규화로는
    //   같은 학교로 묶이지 않음. firebase 원본을 정답으로 간주하고 같은 이름의 firebase
    //   학생이 있으면 그 학교명을 virtual 에도 채워준다.
    //
    // 동명이인이 있으면 학교명이 비어있지 않은 virtual 만 정규화 매칭. 빈 학교는
    // 첫 번째 firebase 학생 학교명 사용 (best-effort).
    const fbStudentsByName = new Map<string, Student[]>();
    for (const s of withEnrollments) {
      if (!s.name) continue;
      const list = fbStudentsByName.get(s.name) || [];
      list.push(s);
      fbStudentsByName.set(s.name, list);
    }
    const resolveSchool = (vName: string, vSchool: string): string => {
      const cands = fbStudentsByName.get(vName) || [];
      if (cands.length === 0) return normalizeSchool(vSchool);
      if (cands.length === 1) return cands[0].school || normalizeSchool(vSchool);
      // 동명이인 — virtual school 정규화 후 prefix 매칭
      const vn = normalizeSchool(vSchool);
      if (!vn) return cands[0].school || "";
      const match = cands.find(
        (c) =>
          (c.school || "") === vn ||
          (c.school || "").includes(vn) ||
          vn.includes(c.school || "")
      );
      return match?.school || cands[0].school || vn;
    };

    // 동명이인 dedup 키도 정규화된 학교로
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
        const resolved = resolveSchool(v.name || "", v.school || "");
        const key = `${v.name}|${resolved}`;
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
          school: resolveSchool(v.name || "", v.school || ""),
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
