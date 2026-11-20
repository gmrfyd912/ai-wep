// 1단계 미리보기용 가짜 데이터. 6단계에서 Supabase 데이터로 교체한다.
// 과정 이름과 사람 이름은 데이터이므로 번역하지 않는다.
// 결함은 항상 영어 코드로 저장하고 화면에서만 번역한다(defect_<code>).

export type DefectCode = "porosity" | "undercut" | "overlap" | "spatter" | "crack" | "none";

export type Course = {
  id: string;
  name: string;
  homeroom: string;
  active: boolean;
  weeklySubmissions: number;
};

export type Student = {
  id: string;
  name: string;
  courseId: string;
  lastScore: number;
  submissions: number;
  trend: "up" | "down" | "flat";
  frequentDefect: DefectCode;
};

export type Result = {
  id: string;
  studentId: string;
  score: number;
  widthDevMm: number;
  straightDevMm: number;
  defects: DefectCode[];
};

export const COURSES: Course[] = [
  { id: "c1", name: "뉴딜2기", homeroom: "김교사", active: true, weeklySubmissions: 18 },
  { id: "c2", name: "뉴딜3기", homeroom: "김교사", active: true, weeklySubmissions: 24 },
  { id: "c3", name: "뉴딜4기", homeroom: "이교사", active: true, weeklySubmissions: 12 },
  { id: "c4", name: "특기병", homeroom: "박교사", active: true, weeklySubmissions: 30 },
  { id: "c5", name: "페루반", homeroom: "최교사", active: true, weeklySubmissions: 9 },
];

export const STUDENTS: Student[] = [
  { id: "s1", name: "김민수", courseId: "c1", lastScore: 82, submissions: 12, trend: "up", frequentDefect: "undercut" },
  { id: "s2", name: "Nguyen Van An", courseId: "c1", lastScore: 74, submissions: 9, trend: "flat", frequentDefect: "porosity" },
  { id: "s3", name: "이서준", courseId: "c2", lastScore: 91, submissions: 15, trend: "up", frequentDefect: "none" },
  { id: "s4", name: "Somchai P.", courseId: "c2", lastScore: 68, submissions: 7, trend: "down", frequentDefect: "spatter" },
  { id: "s5", name: "박지훈", courseId: "c3", lastScore: 77, submissions: 10, trend: "up", frequentDefect: "overlap" },
  { id: "s6", name: "정우진", courseId: "c4", lastScore: 88, submissions: 20, trend: "flat", frequentDefect: "undercut" },
  { id: "s7", name: "Carlos Quispe", courseId: "c5", lastScore: 71, submissions: 6, trend: "up", frequentDefect: "porosity" },
  { id: "s8", name: "Maria Huaman", courseId: "c5", lastScore: 79, submissions: 8, trend: "up", frequentDefect: "spatter" },
];

export const RESULTS: Result[] = STUDENTS.map((s, i) => ({
  id: `r${i + 1}`,
  studentId: s.id,
  score: s.lastScore,
  widthDevMm: Math.round((0.4 + (100 - s.lastScore) / 30) * 10) / 10,
  straightDevMm: Math.round((0.3 + (100 - s.lastScore) / 40) * 10) / 10,
  defects: s.frequentDefect === "none" ? [] : [s.frequentDefect],
}));

/** 미리보기에서 "나"로 쓰는 교육생과 교사가 맡은 과정 */
export const ME_STUDENT_ID = "s1";
export const TEACHER_COURSE_IDS = ["c1", "c2"];

export const courseById = (id: string) => COURSES.find((c) => c.id === id);
export const studentById = (id: string) => STUDENTS.find((s) => s.id === id);
export const resultById = (id: string) => RESULTS.find((r) => r.id === id);
