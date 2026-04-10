"use client";

import { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Teacher } from "@/types";

export function useStaff() {
  const [staff, setStaff] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(
      collection(db, "staff"),
      where("status", "==", "active")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Teacher[];
      setStaff(data);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const teachers = staff.filter(
    (s) => s.role === "teacher" || s.role === "강사"
  );

  return { staff, teachers, loading };
}
