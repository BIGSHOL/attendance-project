"use client";

import { useEffect, useState } from "react";
import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Student, Enrollment } from "@/types";

export function useStudents() {
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "students"),
      where("status", "in", ["active", "withdrawn"])
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      // 학생 문서 로드
      const studentDocs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<Student, "id">),
      }));

      // 각 학생의 enrollments subcollection 병렬 로드
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

      setStudents(withEnrollments);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { students, loading };
}
