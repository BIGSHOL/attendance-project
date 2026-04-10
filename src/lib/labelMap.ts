const roleMap: Record<string, string> = {
  teacher: "강사",
  admin: "관리자",
  manager: "매니저",
  staff: "직원",
  owner: "원장",
};

const subjectMap: Record<string, string> = {
  math: "수학",
  english: "영어",
  korean: "국어",
  science: "과학",
  social: "사회",
  history: "역사",
  physics: "물리",
  chemistry: "화학",
  biology: "생물",
  "earth-science": "지구과학",
  coding: "코딩",
  essay: "논술",
  highmath: "고등수학",
};

const statusMap: Record<string, string> = {
  active: "재원",
  inactive: "퇴원",
  withdrawn: "퇴원",
  resigned: "퇴직",
  pending: "대기",
  trial: "체험",
  on_hold: "휴원",
  hold: "휴원",
  prospect: "상담중",
  prospective: "상담중",
};

export function toRoleLabel(role: string): string {
  return roleMap[role.toLowerCase()] || role;
}

export function toSubjectLabel(subject: string): string {
  return subjectMap[subject.toLowerCase()] || subject;
}

export function toStatusLabel(status: string): string {
  return statusMap[status.toLowerCase()] || status;
}
