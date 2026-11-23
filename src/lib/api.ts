import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

// 분석 서버 주소 (비밀 아님). app.json 의 expo.extra.apiUrl 에서 읽는다.
export const API_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "https://ai-wep-server.onrender.com";

const DEVICE_KEY = "aiwep.deviceId";
const TOKEN_KEY = "aiwep.token";

/** 휴대폰마다 한 번 만드는 번호. 로그인 전 기록을 계정으로 가져올 때와 시험용 휴대폰 확인에 쓴다. */
export async function getDeviceId(): Promise<string> {
  const saved = await AsyncStorage.getItem(DEVICE_KEY);
  if (saved) return saved;
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  const id = `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
  await AsyncStorage.setItem(DEVICE_KEY, id);
  return id;
}

// ---- 로그인 토큰 (로그아웃 전까지 휴대폰에 저장) ----

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export async function loadToken(): Promise<string | null> {
  token = await AsyncStorage.getItem(TOKEN_KEY);
  return token;
}

export async function saveToken(t: string | null): Promise<void> {
  token = t;
  if (t) await AsyncStorage.setItem(TOKEN_KEY, t);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

/** 서버가 "다시 로그인하세요(401)"라고 하면 부를 함수 (세션 화면이 등록) */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export type Role = "student" | "teacher" | "staff" | "admin";

export type Course = { id: string; name: string };

export type Me = {
  id: string;
  login_id: string;
  name: string;
  role: Role;
  email: string | null;
  status: string;
  must_change_password: boolean;
  /** 행정 관리자 추가 권한 (시스템관리자가 부여) */
  permissions?: { manage_courses: boolean; manage_members: boolean };
  courses: Course[];
  /** 프로필 사진 (서명 주소는 바뀌어도 key 는 그대로라 캐시가 유지된다) */
  avatar_url?: string | null;
  avatar_key?: string | null;
  /** 사진 필수인데 아직 없음 → 로그인 뒤 사진 올리기 화면 */
  needs_avatar?: boolean;
};

/** 이름 옆 둥근 사진 */
export type AvatarFields = { avatar_url?: string | null; avatar_key?: string | null };
/** 목록에 함께 보이는 비드 그림 (확인 그림 작은 판) */
export type BeadFields = { bead_url?: string | null; bead_key?: string | null; bead_ratio?: number | null };

export type AuthResult = { token: string; user: Me } | { pending: true };

export type Status = "ok" | "processing" | "marker_not_found" | "no_bead" | "roboflow_failed" | string;

export type SubmissionSummary = {
  id: string;
  status: Status;
  /** 6-5: 평판/배관 (예전 기록 = 평판) */
  work_type?: "plate" | "pipe";
  pipe_od_mm?: number | null;
  process: string | null;
  position: string | null;
  material: string | null;
  created_at: string;
  width_mean_mm: number | null;
  straight_max_dev_mm: number | null;
  defect_count: number | null;
};

/** 내 기록 목록 한 줄: 요약 + 누적 분석(추이·비교·결함 통계)용 값 */
export type SubmissionListItem = SubmissionSummary & {
  width_std_mm?: number | null;
  width_min_mm?: number | null;
  width_max_mm?: number | null;
  defect_types?: string[];
  /** 5단계 점수(100점)·AI 예비판정. 분석 실패면 null */
  score?: number | null;
  verdict?: Verdict | null;
} & BeadFields;

export type Verdict = "pass" | "fail";

/** 서버 scoring.py 가 정해진 공식으로 계산한 점수 (AI가 정하지 않음) */
export type ScoreInfo = {
  score: number;
  verdict: Verdict;
  fail_reasons: string[];
  /** 점수가 pass_score 미만이라 불합격 */
  fail_low_score?: boolean;
  pass_score?: number;
  parts: {
    width: { points: number; max: number; value_mm: number };
    straight: { points: number; max: number; value_mm: number };
    defects: { points: number; max: number; items: { type: string; minus: number }[] };
  };
};

/** AI 종합리포트 (선택한 언어로 작성됨) */
export type AiReport = {
  summary: string;
  strengths: string[];
  improvements: string[];
  practice: string[];
  comparison: string;
};

export type ReportResponse = {
  report: AiReport;
  score: ScoreInfo;
  cached: boolean;
  limit: number;
  remaining?: number;
};

/** 확인 그림 배치 (4단계 이후 결과만): 그림 왼쪽·오른쪽 끝 = 시작에서 몇 mm.
 * dev_sign 을 직진도 이탈값에 곱하면 그림 위쪽이 그래프 + 쪽이 된다. */
export type CheckLayout = { x_start_mm: number; x_end_mm: number; width: number; height: number; dev_sign: number };

export type EngineResult = {
  status: Status;
  warnings?: string[];
  check_layout?: CheckLayout | null;
  bead?: {
    length_mm: number;
    width: {
      mean_mm: number;
      min_mm: number;
      max_mm: number;
      std_mm: number;
      min_pos_mm?: number;
      max_pos_mm?: number;
      end_trim_mm?: number;
      /** 검사 구간 (시작에서 거리 mm). 평판 = 양 끝 10mm 제외, 배관 = 꼭대기 양쪽 45° */
      zone_start_mm?: number;
      zone_end_mm?: number;
      /** 배관: 검사 구간 왼쪽 끝(45° 지점)에서 원둘레 거리 */
      min_pos_arc_mm?: number;
      max_pos_arc_mm?: number;
      /** [시작에서 거리 mm, 폭 mm] 1mm마다 (양 끝 구간 포함) */
      profile?: [number, number][];
    };
    straightness: {
      max_dev_mm: number;
      max_dev_pos_mm?: number;
      max_dev_pos_arc_mm?: number;
      /** 기준선: 평판 = 직선, 배관 = 곡선 */
      baseline?: "line" | "curve";
      /** [시작에서 거리 mm, 기준선 대비 이탈 mm] 1mm마다. 4단계 이전 결과에는 없음 */
      profile?: [number, number][];
    };
    /** 6-5 배관: 외경, 꼭대기 위치, 검사 구간 원둘레 길이 */
    pipe?: { od_mm: number; top_pos_mm: number; zone_arc_mm: number };
  };
  defects?: { type: string; length_mm: number | null; confidence: number; pos_along_bead_mm?: number | null }[];
};

export type Submission = SubmissionSummary & {
  /** 기록 주인. 교사 등이 학생 결과를 볼 때는 owner_name 도 온다 */
  user_id?: string;
  owner_name?: string | null;
  /** 이 사람이 AI 리포트를 새로 만들 수 있는지 (본인·담당 교사·관리자) */
  can_report?: boolean;
  owner_avatar_url?: string | null;
  owner_avatar_key?: string | null;
  score?: ScoreInfo | null;
  /** 6-4b: 적용 중인 선급규정으로 본 예비판정 (없으면 카드 숨김) */
  class_judgment?: ClassJudgment;
  result: EngineResult | null;
  photo_url: string | null;
  check_url: string | null;
};

/** 실패 원인 코드. 화면 문구 끝에 함께 보여 줘서 원인을 구분한다. */
export class NetworkError extends Error {
  /** status = 서버 응답 번호(없으면 0), detail = 서버가 보낸 원인 (예: { code: "daily_limit", limit: 2 }) */
  constructor(
    public code: string,
    public status = 0,
    public detail: { code?: string; limit?: number; min?: number } | null = null,
  ) {
    super(code);
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 30000): Promise<T> {
  const step = path.split("?")[0].split("/")[1] || "api";
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    const headers = { ...authHeaders(), ...((init.headers as Record<string, string>) ?? {}) };
    res = await fetch(`${API_URL}${path}`, { ...init, headers, signal: ctrl.signal });
  } catch (e) {
    const err = e as Error;
    const secs = Math.round((Date.now() - started) / 1000);
    const msg = err?.message ?? String(e);
    const code =
      err?.name === "AbortError" || /cancel/i.test(msg)
        ? `${step}: timeout ${secs}s`
        : `${step}: network ${secs}s ${msg}`;
    console.warn(`[api] ${init.method ?? "GET"} ${API_URL}${path} 실패:`, code);
    throw new NetworkError(code);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn(`[api] ${path} 서버 오류 ${res.status}:`, body.slice(0, 300));
    let detail: { code?: string; limit?: number; min?: number } | null = null;
    try {
      const d = JSON.parse(body)?.detail;
      if (d && typeof d === "object") detail = d;
    } catch {
      // 본문이 JSON 이 아니면 무시
    }
    if (res.status === 401 && token && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new NetworkError(`${step}: server ${res.status}`, res.status, detail);
  }
  return (await res.json()) as T;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 서버가 잠들어 있으면 깨운다 (무료 서버는 15분 쉬면 잠들고, 깨는 데 1분쯤 걸림). */
export async function wakeServer(): Promise<void> {
  await request<{ ok: boolean }>("/health", {}, 120000);
}

/** 사진을 서버로 보내 분석한다.
 * 사진 업로드는 React Native 기본 XMLHttpRequest 로 보낸다. (SDK 58 의 fetch 는
 * { uri } 형태 파일을 FormData 에 담는 방식을 지원하지 않는다.) */
export async function analyzePhoto(
  uri: string,
  info: { process: string; position: string; material: string; work_type: "plate" | "pipe"; pipe_od_mm?: string },
  opts: { jobId?: string; onUploadProgress?: (ratio: number) => void } = {},
): Promise<Submission> {
  const form = new FormData();
  if (opts.jobId) form.append("job_id", opts.jobId);
  form.append("device_id", await getDeviceId());
  form.append("process", info.process);
  form.append("position", info.position);
  form.append("material", info.material);
  form.append("work_type", info.work_type);
  if (info.work_type === "pipe") form.append("pipe_od_mm", info.pipe_od_mm ?? "");
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("photo", blob, "photo.jpg");
  } else {
    form.append("photo", { uri, name: "photo.jpg", type: "image/jpeg" } as unknown as Blob);
  }
  const started = Date.now();
  const secs = () => Math.round((Date.now() - started) / 1000);
  return new Promise<Submission>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/analyze`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.timeout = 180000;
    if (opts.onUploadProgress && xhr.upload) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) opts.onUploadProgress?.(e.loaded / e.total);
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Submission);
        } catch {
          reject(new NetworkError(`analyze: bad response ${secs()}s`));
        }
      } else {
        console.warn(`[api] analyze 서버 오류 ${xhr.status}:`, xhr.responseText?.slice(0, 300));
        if (xhr.status === 401) onUnauthorized?.();
        let detail = "";
        try {
          detail = String(JSON.parse(xhr.responseText)?.detail ?? "");
        } catch {
          /* 본문이 JSON 이 아님 */
        }
        reject(new NetworkError(`analyze: server ${xhr.status}${detail ? ` ${detail}` : ""}`));
      }
    };
    xhr.onerror = () => {
      console.warn("[api] analyze 연결 실패", secs(), "s");
      reject(new NetworkError(`analyze: network ${secs()}s`));
    };
    xhr.ontimeout = () => reject(new NetworkError(`analyze: timeout ${secs()}s`));
    xhr.send(form);
  });
}

/** 분석 진행 단계 순서 (앱 표시용). wake·upload 는 앱이, 나머지는 서버가 알려 준다. */
export const STAGES = ["wake", "upload", "save_photo", "marker", "roboflow", "measure", "save_result"] as const;
export type Stage = (typeof STAGES)[number];

export function newJobId(): string {
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  return `job-${hex()}${hex()}-${hex()}${hex()}`;
}

/** 서버에 지금 진행 중인 단계를 묻는다 (실패하면 null). */
export async function getProgress(jobId: string): Promise<string | null> {
  try {
    const r = await request<{ stage: string | null }>(`/progress/${jobId}`, {}, 5000);
    return r.stage;
  } catch {
    return null;
  }
}

export async function listSubmissions(): Promise<SubmissionListItem[]> {
  return request<SubmissionListItem[]>(`/submissions`, {}, 90000);
}

export async function getSubmission(sid: string): Promise<Submission> {
  return request<Submission>(`/submissions/${sid}`, {}, 90000);
}

/** AI 리포트: 탭을 열면 부른다. 같은 사진·같은 언어로 만든 적이 있으면 서버가 저장된 것을 돌려준다.
 * 처음 만들 때는 서버가 깨어나는 시간 + AI 작성 시간이 걸려서 넉넉히 기다린다. */
export async function getReport(sid: string, lang: string): Promise<ReportResponse> {
  const device_id = await getDeviceId();
  return request<ReportResponse>(
    `/submissions/${sid}/report`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device_id, lang }) },
    150000,
  );
}

/** 상태 코드 → 번역 키 */
export function statusKey(s: Status): string {
  if (s === "processing") return "status_processing";
  if (s === "marker_not_found" || s === "no_bead" || s === "roboflow_failed") return `status_${s}`;
  return "status_error";
}

// ---- 6-1단계: 계정 ----

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

/** 로그인·가입은 서버가 잠들어 있으면 깨는 데 1분쯤 걸려서 넉넉히 기다린다. */
const AUTH_TIMEOUT = 120000;

export async function listCourses(): Promise<Course[]> {
  return request<Course[]>("/courses", {}, AUTH_TIMEOUT);
}

export async function login(login_id: string, password: string): Promise<{ token: string; user: Me }> {
  const device_id = await getDeviceId();
  return request("/auth/login", json("POST", { login_id, password, device_id }), AUTH_TIMEOUT);
}

export async function signup(form: {
  login_id: string;
  password: string;
  name: string;
  role: Exclude<Role, "admin">;
  email: string | null;
  course_ids: string[];
  avatar_b64?: string | null;
}): Promise<AuthResult> {
  const device_id = await getDeviceId();
  return request("/auth/signup", json("POST", { ...form, device_id }), AUTH_TIMEOUT);
}

export async function getSignupPhotoRule(): Promise<{ avatar_required: boolean }> {
  return request("/auth/signup-rules", {}, AUTH_TIMEOUT);
}

/** 프로필 사진 올리기·바꾸기 (줄인 JPEG 파일) */
export async function uploadAvatar(uri: string): Promise<Me> {
  const form = new FormData();
  if (Platform.OS === "web") {
    const blob = await (await fetch(uri)).blob();
    form.append("photo", blob, "avatar.jpg");
  } else {
    form.append("photo", { uri, name: "avatar.jpg", type: "image/jpeg" } as unknown as Blob);
  }
  return new Promise<Me>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/me/avatar`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.timeout = 90000;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Me);
        } catch {
          reject(new NetworkError("avatar: bad response"));
        }
        return;
      }
      if (xhr.status === 401) onUnauthorized?.();
      let detail: { code?: string } | null = null;
      try {
        const d = JSON.parse(xhr.responseText)?.detail;
        if (d && typeof d === "object") detail = d;
      } catch {
        /* 본문이 JSON 이 아님 */
      }
      reject(new NetworkError(`avatar: server ${xhr.status}`, xhr.status, detail));
    };
    xhr.onerror = () => reject(new NetworkError("avatar: network"));
    xhr.ontimeout = () => reject(new NetworkError("avatar: timeout"));
    xhr.send(form);
  });
}

export async function getMe(): Promise<Me> {
  return request<Me>("/me", {}, AUTH_TIMEOUT);
}

export async function logout(): Promise<void> {
  await request("/auth/logout", { method: "POST" }, 15000);
}

export async function changePassword(current: string, next: string): Promise<Me> {
  return request<Me>("/me/password", json("POST", { current, new: next }), AUTH_TIMEOUT);
}

export async function updateEmail(email: string | null): Promise<Me> {
  return request<Me>("/me", json("PATCH", { email }), AUTH_TIMEOUT);
}

export async function findId(email: string, lang: string): Promise<void> {
  await request("/auth/find-id", json("POST", { email, lang }), AUTH_TIMEOUT);
}

export async function sendResetCode(login_id: string, lang: string): Promise<{ email: string }> {
  return request("/auth/forgot", json("POST", { login_id, lang }), AUTH_TIMEOUT);
}

export async function resetPassword(
  login_id: string,
  code: string,
  new_password: string,
): Promise<{ token: string; user: Me }> {
  const device_id = await getDeviceId();
  return request("/auth/reset", json("POST", { login_id, code, new_password, device_id }), AUTH_TIMEOUT);
}

/** 로그인 전에 이 휴대폰으로 분석한 기록 수 */
export async function countDeviceRecords(): Promise<number> {
  const id = encodeURIComponent(await getDeviceId());
  const r = await request<{ count: number }>(`/me/device-records?device_id=${id}`, {}, AUTH_TIMEOUT);
  return r.count;
}

export async function claimDeviceRecords(): Promise<number> {
  const device_id = await getDeviceId();
  const r = await request<{ moved: number }>("/me/claim-device", json("POST", { device_id }), AUTH_TIMEOUT);
  return r.moved;
}

export async function deleteAccount(password: string): Promise<void> {
  await request("/me/delete", json("POST", { password }), AUTH_TIMEOUT);
}

/** 서버 오류 → 화면 문구 키 (auth_err_...) 와 값 */
export function authErrorKey(e: unknown): { key: string; values: { min?: number } } {
  if (e instanceof NetworkError && e.detail?.code) {
    return { key: `auth_err_${e.detail.code}`, values: { min: e.detail.min } };
  }
  return { key: "error_network", values: {} };
}

// ---- 6-2단계: 과정·회원 관리, 보드 ----

export type CourseRole = "homeroom" | "assistant";
export type CourseTeacher = { id: string; name: string; course_role: CourseRole | null };
export type ManagedCourse = {
  id: string;
  name: string;
  active: boolean;
  teachers: CourseTeacher[];
  student_count: number;
};
export type Member = {
  id: string;
  login_id: string;
  name: string;
  role: Exclude<Role, "admin">;
  status: "active" | "pending" | "disabled";
  email: string | null;
  permissions: { manage_courses: boolean; manage_members: boolean };
  courses: (Course & { course_role: CourseRole | null })[];
  created_at: string;
  last_login_at: string | null;
};
/** 사람 기록 화면 머리글. 담당 교사·관리자가 아니면 이름·역할·과정만 온다 */
export type StudentInfo = Pick<Member, "id" | "name" | "role" | "courses"> &
  Partial<Omit<Member, "id" | "name" | "role" | "courses">> & { can_care: boolean; can_edit: boolean } & AvatarFields;
export type Trend = "up" | "down" | "flat";
export type CourseCard = {
  id: string;
  name: string;
  teachers: CourseTeacher[];
  student_count: number;
  pending_count: number;
  weekly_submissions: number;
  avg_score: number | null;
};
export type StudentCard = {
  id: string;
  name: string;
  login_id: string;
  status: "active" | "pending" | "disabled";
  total: number;
  week_count: number;
  last_score: number | null;
  avg_score: number | null;
  trend: Trend;
  frequent_defect: string | null;
  last_at: string | null;
} & AvatarFields;
export type CourseBoard = {
  course: { id: string; name: string; active: boolean };
  teachers: CourseTeacher[];
  students: StudentCard[];
  summary: { student_count: number; weekly_submissions: number; avg_score: number | null };
  can_care: boolean;
};

const BOARD_TIMEOUT = 90000;

export const listManagedCourses = () => request<ManagedCourse[]>("/manage/courses", {}, BOARD_TIMEOUT);
export const addCourse = (name: string) => request<ManagedCourse>("/manage/courses", json("POST", { name }), BOARD_TIMEOUT);
export const updateCourse = (id: string, fields: { name?: string; active?: boolean }) =>
  request<ManagedCourse>(`/manage/courses/${id}`, json("PATCH", fields), BOARD_TIMEOUT);
export const setCourseTeachers = (id: string, teachers: { user_id: string; course_role: CourseRole }[]) =>
  request<{ ok: boolean }>(`/manage/courses/${id}/teachers`, json("PUT", { teachers }), BOARD_TIMEOUT);

export const listMembers = () => request<Member[]>("/manage/members", {}, BOARD_TIMEOUT);
export const getMember = (id: string) => request<Member>(`/manage/members/${id}`, {}, BOARD_TIMEOUT);
export const approveMember = (id: string) => request<Member>(`/manage/members/${id}/approve`, { method: "POST" }, BOARD_TIMEOUT);
export const resetMemberPassword = (id: string) =>
  request<{ ok: boolean; password: string }>(`/manage/members/${id}/reset-password`, { method: "POST" }, BOARD_TIMEOUT);
export const updateMember = (
  id: string,
  fields: {
    role?: Member["role"];
    course_ids?: string[];
    status?: "active" | "disabled";
    permissions?: Member["permissions"];
  },
) => request<Member>(`/manage/members/${id}`, json("PATCH", fields), BOARD_TIMEOUT);

export type SignupRules = { student_approval: boolean; staff_approval: boolean; avatar_required: boolean };
export const getSignupRules = () => request<SignupRules>("/manage/settings/signup", {}, BOARD_TIMEOUT);
export const saveSignupRules = (v: SignupRules) =>
  request<SignupRules>("/manage/settings/signup", json("PUT", v), BOARD_TIMEOUT);

export const listCourseCards = () => request<CourseCard[]>("/boards/courses", {}, BOARD_TIMEOUT);
export const getCourseBoard = (id: string) => request<CourseBoard>(`/boards/courses/${id}`, {}, BOARD_TIMEOUT);
export const getStudentInfo = (id: string) => request<StudentInfo>(`/students/${id}`, {}, BOARD_TIMEOUT);
export const listStudentSubmissions = (id: string) =>
  request<SubmissionListItem[]>(`/students/${id}/submissions`, {}, BOARD_TIMEOUT);

/** 행정 관리자 추가 권한 확인 (시스템관리자는 모두 가능) */
export function canManage(user: Me | null, what: "manage_courses" | "manage_members"): boolean {
  if (!user) return false;
  return user.role === "admin" || (user.role === "staff" && !!user.permissions?.[what]);
}

// ---- 6-3: 갤러리·반응·댓글·알림·랭킹 ----

export const EMOJIS = ["heart", "thumbs", "check", "smile", "wow", "sad"] as const;
export type Emoji = (typeof EMOJIS)[number];
export const EMOJI_CHAR: Record<Emoji, string> = { heart: "❤️", thumbs: "👍", check: "✅", smile: "😄", wow: "😮", sad: "😢" };

export type GalleryItem = {
  id: string;
  user_id: string;
  name: string | null;
  role: Role | null;
  courses: string[];
  process: string | null;
  position: string | null;
  material: string | null;
  work_type?: "plate" | "pipe";
  pipe_od_mm?: number | null;
  created_at: string;
  score: number | null;
  verdict: string | null;
  photo_url: string | null;
  /** 사진 파일 경로: 캐시 열쇠 (주소의 서명은 매번 달라도 같은 사진이면 다시 받지 않음) */
  photo_key?: string | null;
  reactions: Partial<Record<Emoji, number>>;
  my_reaction: Emoji | null;
  comment_count: number;
} & AvatarFields;

export function getGallery(q: { course?: string; process?: string; position?: string; before?: string; work_type?: string }) {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => v && p.set(k, v));
  return request<{ items: GalleryItem[]; more: boolean }>(`/gallery?${p.toString()}`, {}, BOARD_TIMEOUT);
}

export type CommentItem = {
  id: string;
  parent_id: string | null;
  user_id: string;
  name: string | null;
  role: Role | null;
  body: string;
  created_at: string;
  can_delete: boolean;
} & AvatarFields;
export type Social = {
  reactions: Partial<Record<Emoji, number>>;
  my_reaction: Emoji | null;
  comments: CommentItem[];
  hidden: boolean;
  can_moderate: boolean;
};

export const getSocial = (sid: string) => request<Social>(`/submissions/${sid}/social`, {}, BOARD_TIMEOUT);
export const setReaction = (sid: string, emoji: Emoji | null) =>
  request<Pick<Social, "reactions" | "my_reaction">>(`/submissions/${sid}/reaction`, json("PUT", { emoji }), BOARD_TIMEOUT);
export const addComment = (sid: string, body: string, parent_id?: string | null) =>
  request<CommentItem>(`/submissions/${sid}/comments`, json("POST", { body, parent_id: parent_id ?? null }), BOARD_TIMEOUT);
export const deleteComment = (cid: string) => request<{ ok: boolean }>(`/comments/${cid}`, { method: "DELETE" }, BOARD_TIMEOUT);
export const setHidden = (sid: string, hidden: boolean) =>
  request<{ ok: boolean; hidden: boolean }>(`/submissions/${sid}/hide`, json("POST", { hidden }), BOARD_TIMEOUT);

export type NotificationItem = {
  id: string;
  kind: "comment" | "reply";
  submission_id: string | null;
  actor_name: string | null;
  body: string;
  process: string | null;
  position: string | null;
  created_at: string;
  read: boolean;
} & AvatarFields;
export const listNotifications = () => request<NotificationItem[]>("/notifications", {}, BOARD_TIMEOUT);
export const unreadCount = () => request<{ count: number }>("/notifications/unread", {}, 20000);
export const markNotificationsRead = (ids?: string[]) =>
  request<{ ok: boolean }>("/notifications/read", json("POST", { ids: ids ?? null }), BOARD_TIMEOUT);

export type RankPeriod = "day" | "week" | "month" | "all";
export type RankRow = {
  rank: number;
  user_id: string;
  name: string;
  courses: string[];
  score: number;
  verdict: string;
  submission_id: string;
  created_at: string;
  process?: string | null;
  position?: string | null;
  work_type?: "plate" | "pipe";
} & AvatarFields &
  BeadFields;
/** process·position·work_type 이 "" 이면 전체 */
export function getRanking(q: { process: string; position: string; period: RankPeriod; course: string; work_type: string }) {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => v && p.set(k, v));
  return request<{ rows: RankRow[]; me: RankRow | null; total: number }>(`/ranking?${p.toString()}`, {}, BOARD_TIMEOUT);
}

// ---- 6-4: 시스템관리자 설정·학습용 사진 받기 ----

export type ScoreRule = { points: number; full_mm: number; zero_mm: number };
export type AdminSettings = {
  pass_score: number;
  width: ScoreRule;
  straight: ScoreRule;
  defects: { points: number; porosity: number; undercut: number; overlap: number; spatter: number; other: number };
  crack_fail: boolean;
  fail_score_cap: number;
  report_daily_limit: number;
  password_min_length: number;
  reset_password: string;
  updated_at?: string | null;
  updated_by?: string | null;
};
export const getAdminSettings = () => request<AdminSettings>("/admin/settings", {}, BOARD_TIMEOUT);
export const saveAdminSettings = (v: AdminSettings) => request<AdminSettings>("/admin/settings", json("PUT", v), BOARD_TIMEOUT);

export type ExportRange = "all" | "period" | "new";
export type ExportQuery = {
  range: ExportRange;
  date_from?: string;
  date_to?: string;
  process: string;
  position: string;
  course: string;
  work_type: string;
};
export type ExportPart = { index: number; first: number; last: number; date_from: string; date_to: string; path: string };
export type ExportSummary = { total: number; labeled: number; parts: ExportPart[]; expires_at: number; last_export_at: string | null };
export const trainingExport = (q: ExportQuery) =>
  request<ExportSummary>("/admin/training-export", json("POST", q), BOARD_TIMEOUT);

// ---- 6-4b: 선급규정 ----

export const RULE_KEYS = ["crack", "porosity", "undercut", "overlap", "spatter", "width_variation", "straightness"] as const;
export type RuleKey = (typeof RULE_KEYS)[number];
/** 규정의 어디에서 나온 기준인지 (쪽·표 번호·원문) */
export type RuleSource = { page: number | null; ref: string; quote: string } | null;
export type RuleItem = {
  /** 이 항목을 판정할지 */
  check: boolean;
  /** 결함 항목: false 면 1개라도 있으면 불합격 */
  allowed?: boolean;
  max_diameter_mm?: number | null;
  max_count?: number | null;
  per_length_mm?: number | null;
  max_length_mm?: number | null;
  /** 언더컷 허용 깊이: 사진으로 못 재서, 보이면 '확인 필요' (교사가 깊이 확인) */
  max_depth_mm?: number | null;
  /** 폭 변화·직진도 한계 */
  max_mm?: number | null;
  source: RuleSource;
  note: string;
};
export type Joint = "" | "butt" | "fillet";
/** h ≤ base + coef × 비드 폭, 최대 cap (덧살·볼록 높이처럼 폭으로 계산되는 허용치) */
export type RuleFormula = { base: number; coef: number; cap: number | null };
export type ManualRule = {
  name: string;
  rule: string;
  source: RuleSource;
  /** 맞대기만 / 필릿만 / 공통("") */
  joint?: Joint;
  formula?: RuleFormula | null;
  /** 결과 화면: 이 비드 폭으로 계산한 허용치 */
  limit_mm?: number;
  basis_mm?: number;
};
export const NEXT_TEST_KINDS = ["plate_butt", "plate_fillet", "pipe_butt", "pipe_fillet"] as const;
export type RuleOptions = {
  /** 평판 검사 범위: 가운데 몇 mm (비우면 양 끝 10mm만 빼고 전체) */
  plate_zone_mm: number | null;
  /** 균열은 양 끝 10mm 도 본다 (크레이터 균열) */
  crack_ends: boolean;
  /** 육안검사 다음 시험 안내 (시편 종류별) */
  next_tests: Record<(typeof NEXT_TEST_KINDS)[number], string>;
};
export type RuleFile = { name: string; type: string; pages: number; url?: string | null };
export type RuleSet = {
  id: string;
  name: string;
  society: string;
  notes: string;
  active: boolean;
  created_at: string;
  updated_at: string | null;
  updated_by?: string | null;
  items: Record<RuleKey, RuleItem>;
  manual: ManualRule[];
  options: RuleOptions;
  files: RuleFile[];
};
export type RuleSetSummary = Pick<RuleSet, "id" | "name" | "society" | "active" | "updated_at"> & {
  files: number;
  checked: number;
  manual: number;
};
export type ClassJudgmentItem = {
  key: RuleKey;
  check: "none" | "max_diameter" | "count" | "max_length" | "allowed" | "max" | "depth";
  /** null = 확인 필요 (교사가 깊이 확인) */
  ok: boolean | null;
  /** 균열: 양 끝까지 봤음 */
  ends?: boolean;
  measured: number;
  limit: number | null;
  unit: "mm" | "count";
  /** 개수 기준이 적용되는 길이 (예: 100mm 당 2개) */
  per_mm?: number | null;
  source: RuleSource;
  note: string;
};
/** 결과 화면 '선급 예비판정' (적용 중인 규정이 있을 때만 온다) */
export type ClassJudgment = {
  set_id: string;
  name: string;
  society: string;
  verdict: "pass" | "fail" | "review" | null;
  items: ClassJudgmentItem[];
  manual: ManualRule[];
  joint?: "butt" | "fillet" | null;
  /** 평판 가운데 검사 범위 (시작에서 mm) */
  zone?: { start_mm: number; end_mm: number; length_mm: number } | null;
  /** 배관: 사진에 보이는 부분만 봄 */
  pipe_partial?: boolean;
  next_test?: string;
};

export const listRules = () => request<{ items: RuleSetSummary[]; model: string }>("/admin/rules", {}, BOARD_TIMEOUT);
export const getRule = (id: string) => request<RuleSet>(`/admin/rules/${id}`, {}, BOARD_TIMEOUT);
export const createRule = (name: string) => request<RuleSet>("/admin/rules", json("POST", { name }), BOARD_TIMEOUT);
export const saveRule = (id: string, v: Pick<RuleSet, "name" | "society" | "notes" | "items" | "manual" | "options">) =>
  request<RuleSet>(`/admin/rules/${id}`, json("PUT", v), BOARD_TIMEOUT);
export const activateRule = (id: string, active: boolean) =>
  request<{ ok: boolean; active: boolean }>(`/admin/rules/${id}/activate`, json("POST", { active }), BOARD_TIMEOUT);
export const deleteRule = (id: string) => request<{ ok: boolean }>(`/admin/rules/${id}`, { method: "DELETE" }, BOARD_TIMEOUT);

/** 고른 규정 파일 (PDF·사진). 웹은 file, 휴대폰은 uri */
export type PickedFile = { uri: string; name: string; mimeType?: string | null; file?: Blob | null };

/** 규정 파일을 올리면 AI가 읽고 초안 세트를 만든다 (1~3분 걸림) */
export async function extractRule(files: PickedFile[], name: string): Promise<RuleSet> {
  const form = new FormData();
  form.append("name", name);
  for (const f of files) {
    const type = f.mimeType || (/\.pdf$/i.test(f.name) ? "application/pdf" : "image/jpeg");
    if (Platform.OS === "web") {
      const blob = f.file ?? (await (await fetch(f.uri)).blob());
      form.append("files", blob, f.name);
    } else {
      form.append("files", { uri: f.uri, name: f.name, type } as unknown as Blob);
    }
  }
  return new Promise<RuleSet>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/admin/rules/extract`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.timeout = 300000;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as RuleSet);
        } catch {
          reject(new NetworkError("rules: bad response"));
        }
        return;
      }
      if (xhr.status === 401) onUnauthorized?.();
      let detail: { code?: string; limit?: number; min?: number } | null = null;
      try {
        const d = JSON.parse(xhr.responseText)?.detail;
        if (d && typeof d === "object") detail = d;
      } catch {
        /* 본문이 JSON 이 아님 */
      }
      reject(new NetworkError(`rules: server ${xhr.status}`, xhr.status, detail));
    };
    xhr.onerror = () => reject(new NetworkError("rules: network"));
    xhr.ontimeout = () => reject(new NetworkError("rules: timeout"));
    xhr.send(form);
  });
}
