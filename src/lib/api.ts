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
  /** 이면 사진도 올린 기록 (목록에 "정면·이면" 표시) */
  has_back?: boolean;
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
  /** AI 윤곽 검토에서 '윤곽 확인 필요' (볼 수 있는 사람에게만 옴) */
  outline_check?: boolean;
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

/** 윤곽 2차 검토 (Claude 비전): 측정에 쓴 가장자리가 비드 끝을 따라가는지 */
export type OutlineReview = {
  status: "ok" | "check" | "failed";
  reason?: "none" | "cuts_into_bead" | "includes_plate" | "shadow" | "glare" | "spatter" | "other";
  where?: "none" | "start" | "middle" | "end" | "whole";
};

export type EngineResult = {
  status: Status;
  warnings?: string[];
  outline_review?: OutlineReview;
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

/** 이면(뒷면) 결과: 정면과 같은 분석. 이면 사진을 올린 기록에만 있다 */
export type BackSide = {
  status: Status;
  result: EngineResult | null;
  photo_url: string | null;
  check_url: string | null;
  width_mean_mm: number | null;
  straight_max_dev_mm: number | null;
  defect_count: number | null;
  score?: ScoreInfo | null;
  class_judgment?: ClassJudgment;
};

export type Submission = SubmissionSummary & {
  /** 이면 사진도 올렸으면 이면 결과 */
  back?: BackSide;
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
  opts: { jobId?: string; onUploadProgress?: (ratio: number) => void; backUri?: string | null } = {},
): Promise<Submission> {
  const form = new FormData();
  if (opts.jobId) form.append("job_id", opts.jobId);
  form.append("device_id", await getDeviceId());
  form.append("process", info.process);
  form.append("position", info.position);
  form.append("material", info.material);
  form.append("work_type", info.work_type);
  if (info.work_type === "pipe") form.append("pipe_od_mm", info.pipe_od_mm ?? "");
  const addPhoto = async (field: string, u: string) => {
    if (Platform.OS === "web") {
      const blob = await (await fetch(u)).blob();
      form.append(field, blob, `${field}.jpg`);
    } else {
      form.append(field, { uri: u, name: `${field}.jpg`, type: "image/jpeg" } as unknown as Blob);
    }
  };
  await addPhoto("photo", uri);
  // 이면(뒷면) 사진은 선택: 있으면 정면과 함께 보내 한 번에 분석한다
  if (opts.backUri) await addPhoto("back_photo", opts.backUri);
  const started = Date.now();
  const secs = () => Math.round((Date.now() - started) / 1000);
  return new Promise<Submission>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/analyze`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.timeout = opts.backUri ? 300000 : 180000;
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
/** 이면 사진도 올렸을 때: 정면 측정 다음에 '이면 분석' 단계가 들어간다 */
export const STAGES_WITH_BACK = ["wake", "upload", "save_photo", "marker", "roboflow", "measure", "back", "save_result"] as const;
export type Stage = (typeof STAGES_WITH_BACK)[number];

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
  /** 웰디(AI 학습 보조) 교육생 하루 질문 수 */
  tutor_daily_limit?: number;
  /** 윤곽 2차 검토: 끔 / 교사·관리자만 보임 / 모두 보임 */
  outline_review?: OutlineMode;
  password_min_length: number;
  reset_password: string;
  updated_at?: string | null;
  updated_by?: string | null;
};
export type OutlineMode = "off" | "staff" | "all";
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
  /** 윤곽 확인 필요(AI 검토)로 표시된 사진만 */
  outline_check?: boolean;
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

// ---- T1(이론): 교재 ----

/** 목차 (쪽 = 책에 인쇄된 번호, pdf_page = 앱에서 여는 쪽) */
export type TocSection = { title: string; page: number | null; pdf_page?: number | null };
export type TocChapter = {
  title: string;
  page: number | null;
  sections: TocSection[];
  pdf_page?: number | null;
  end_pdf_page?: number | null;
  /** 이 장에서 다 본 쪽 / 전체 쪽 */
  done?: number;
  total?: number;
};
export type TocPart = {
  title: string;
  page: number | null;
  chapters: TocChapter[];
  pdf_page?: number | null;
  end_pdf_page?: number | null;
  done?: number;
  total?: number;
};
export type TextbookInfo = { id: string; title: string; pages: number; page_offset: number };
export type MyTextbook =
  | { book: null }
  | {
      book: TextbookInfo;
      can_view: boolean;
      last_page: number | null;
      done_count: number;
      /** 다 본 쪽 (PDF 쪽 번호) */
      done_pages: number[];
      toc: TocPart[];
    };
export type TextbookPage = { page: number; url: string | null; key: string; width: number; height: number };

export const getMyTextbook = () => request<MyTextbook>("/textbook", {}, BOARD_TIMEOUT);
export const getTextbookPages = (bookId: string, start: number, end: number) =>
  request<{ items: TextbookPage[] }>(`/textbook/pages?book_id=${bookId}&start=${start}&end=${end}`, {}, BOARD_TIMEOUT);
/** 다 본 쪽(넘긴 쪽)과 마지막으로 보던 쪽 */
let progressSaving: Promise<unknown> = Promise.resolve();
export const saveTextbookProgress = (bookId: string, done: number[], last: number | null) => {
  const p = request<{ ok: boolean }>("/textbook/progress", json("POST", { book_id: bookId, done, last }), BOARD_TIMEOUT);
  progressSaving = Promise.all([progressSaving, p.catch(() => null)]);
  return p;
};
/** 진도 저장이 끝난 뒤에 내 교재 정보를 받는다 (교재 보기에서 막 돌아왔을 때 진도가 늦게 보이지 않게) */
export const getMyTextbookAfterSave = async () => {
  await progressSaving;
  return getMyTextbook();
};

export type AdminTextbook = {
  id: string;
  title: string;
  pages: number;
  processed: number;
  status: "processing" | "ready" | "failed";
  error: string;
  page_offset: number;
  toc_pages: string;
  is_current: boolean;
  show_students: boolean;
  use_for_ai: boolean;
  toc: TocPart[];
  /** 지금 서버에서 나누는 중 (false 인데 processing 이면 멈춘 것 → 같은 PDF 로 이어서) */
  running: boolean;
  /** 예전 화질(1100px) 쪽이 남아 있음 (교재 하나 볼 때만 옴) */
  low_quality?: boolean;
  created_at: string;
  updated_at: string;
};
export type SaveTextbook = Partial<
  Pick<AdminTextbook, "title" | "page_offset" | "toc_pages" | "toc" | "is_current" | "show_students" | "use_for_ai">
>;

export const listTextbooks = () => request<{ items: AdminTextbook[]; ai_model: string }>("/admin/textbooks", {}, BOARD_TIMEOUT);
export const getTextbook = (id: string) => request<AdminTextbook>(`/admin/textbooks/${id}`, {}, BOARD_TIMEOUT);
export const saveTextbook = (id: string, v: SaveTextbook) =>
  request<AdminTextbook>(`/admin/textbooks/${id}`, json("PUT", v), BOARD_TIMEOUT);
export const aiTextbookToc = (id: string, pages: string) =>
  request<AdminTextbook>(`/admin/textbooks/${id}/toc/ai`, json("POST", { pages }), 300000);
export const deleteTextbook = (id: string) => request<{ ok: boolean }>(`/admin/textbooks/${id}`, { method: "DELETE" }, BOARD_TIMEOUT);

/** 교재 PDF 올리기 (수십 MB라 오래 걸림). onProgress(0~1) = 올라간 비율. bookId 를 주면 멈춘 교재 이어서 */
export async function uploadTextbook(
  f: PickedFile,
  title: string,
  bookId: string | null,
  onProgress: (ratio: number) => void,
): Promise<AdminTextbook> {
  const form = new FormData();
  form.append("title", title);
  if (bookId) form.append("book_id", bookId);
  if (Platform.OS === "web") {
    const blob = f.file ?? (await (await fetch(f.uri)).blob());
    form.append("file", blob, f.name);
  } else {
    form.append("file", { uri: f.uri, name: f.name || "textbook.pdf", type: "application/pdf" } as unknown as Blob);
  }
  return new Promise<AdminTextbook>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/admin/textbooks/upload`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.timeout = 30 * 60 * 1000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as AdminTextbook);
        } catch {
          reject(new NetworkError("textbook: bad response"));
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
      reject(new NetworkError(`textbook: server ${xhr.status}`, xhr.status, detail));
    };
    xhr.onerror = () => reject(new NetworkError("textbook: network"));
    xhr.ontimeout = () => reject(new NetworkError("textbook: timeout"));
    xhr.send(form);
  });
}

// ---- T2(이론): 매일 문제 ----

/** 문제 종류: ox(OX) / mc(객관식 4지선다) / word(단답형) / short(서술형) — 이 순서로 냄 */
export type QuizKind = "ox" | "mc" | "word" | "short";
export const QUIZ_KINDS: QuizKind[] = ["ox", "mc", "word", "short"];
export type KindCounts = Record<QuizKind, number>;

export type DailyResult = {
  answer: string | null;
  correct: boolean | null;
  score: number | null;
  feedback: string;
  /** auto(OX·객관식·단답형 정답 목록) / ai / teacher / pending(채점 대기) / missed(안 풂) */
  graded_by: "auto" | "ai" | "teacher" | "pending" | "missed";
  correct_choice: number | null;
  model_answer: string;
  explanation: string;
  tr: { model_answer: string; explanation: string } | null;
};
export type DailyItem = {
  id: string;
  kind: QuizKind;
  unit_title: string;
  question: string;
  choices: string[];
  page: number | null;
  printed_page: number | null;
  /** 내 앱 언어 번역 (한국어면 없음) */
  tr: { question: string; choices: string[] } | null;
  result: DailyResult | null;
};
export type MyDaily =
  | { ready: false; reason: "no_book" | "no_questions"; day: string }
  | { ready: true; day: string; book_id: string; items: DailyItem[]; done: number; total: number; score: number; max_score: number; streak: number };

const AI_TIMEOUT = 90000;
export const getMyDaily = (lang: string) => request<MyDaily>(`/daily?lang=${lang}`, {}, AI_TIMEOUT);
export const answerDaily = (questionId: string, answer: number | string, lang: string) =>
  request<DailyItem>("/daily/answer", json("POST", { question_id: questionId, answer, lang }), AI_TIMEOUT);
export const getDailyHistory = (lang: string) =>
  request<{ days: { day: string; items: DailyItem[]; done: number }[] }>(`/daily/history?lang=${lang}`, {}, AI_TIMEOUT);
export const reportQuestion = (questionId: string, reason: string) =>
  request<{ ok: boolean }>("/daily/report", json("POST", { question_id: questionId, reason }), BOARD_TIMEOUT);

export type QuizInfo = {
  status: "" | "running" | "ready" | "failed";
  done: number;
  total: number;
  error: string;
  running: boolean;
  hidden: number;
  reported: number;
  /** 장마다 지금 있는 문제 수 (숨긴 문제 빼고) */
  units: { key: string; title: string; start: number; end: number; printed_start: number; printed_end: number; counts: KindCounts }[];
  offset: number;
  per_unit_default: KindCounts;
  per_unit_max: KindCounts;
} & KindCounts;
/** 만들 범위: 고른 장, 또는 쪽 범위(책에 인쇄된 쪽). counts = 장마다 종류별 개수 */
export type QuizStartBody = { units?: string[]; page_from?: number; page_to?: number; counts: KindCounts; replace: boolean };
export type BankQuestion = {
  id: string;
  unit_key: string;
  unit_title: string;
  kind: QuizKind;
  question: string;
  choices: string[];
  answer: number | null;
  model_answer: string;
  explanation: string;
  page: number | null;
  status: "active" | "hidden";
  report_count: number;
  reasons: string[];
  /** admin = 관리자 문제 은행, tutor = 교육생이 웰디에게 요청해 만든 문제 */
  source?: "admin" | "tutor";
};
export type QuestionEdit = Partial<Pick<BankQuestion, "question" | "choices" | "answer" | "model_answer" | "explanation" | "status">> & {
  clear_reports?: boolean;
};
export const getQuizInfo = (bookId: string) => request<QuizInfo>(`/admin/textbooks/${bookId}/quiz`, {}, BOARD_TIMEOUT);
export const startQuiz = (bookId: string, body: QuizStartBody) =>
  request<QuizInfo>(`/admin/textbooks/${bookId}/quiz`, json("POST", body), BOARD_TIMEOUT);
export const listBankQuestions = (bookId: string, filter: "all" | "reported" | "hidden" | "tutor", kind: QuizKind | "" = "") =>
  request<{ items: BankQuestion[]; offset: number }>(`/admin/textbooks/${bookId}/questions?filter=${filter}&kind=${kind}`, {}, BOARD_TIMEOUT);
export const editBankQuestion = (id: string, v: QuestionEdit) =>
  request<{ ok: boolean }>(`/admin/questions/${id}`, json("PUT", v), BOARD_TIMEOUT);
export const deleteBankQuestion = (id: string) => request<{ ok: boolean }>(`/admin/questions/${id}`, { method: "DELETE" }, BOARD_TIMEOUT);
export type DailySettings = KindCounts;
export const getDailySettings = () => request<DailySettings>("/admin/daily-settings", {}, BOARD_TIMEOUT);
export const saveDailySettings = (v: DailySettings) => request<DailySettings>("/admin/daily-settings", json("PUT", v), BOARD_TIMEOUT);

export type DailyBoardStudent = {
  id: string;
  name: string;
  done: number;
  total: number;
  score: number;
  max_score: number;
  pending: number;
  streak: number;
  weak: string[];
};
export type DailyBoard = {
  day: string;
  students: DailyBoardStudent[];
  summary: { count: number; finished: number };
  weak_units: { title: string; wrong: number }[];
};
export const getDailyBoard = (courseId: string) => request<DailyBoard>(`/boards/courses/${courseId}/daily`, {}, BOARD_TIMEOUT);
export const getStudentDaily = (userId: string, day: string) =>
  request<{ day: string; items: DailyItem[] }>(`/daily/student/${userId}?day=${day}`, {}, BOARD_TIMEOUT);
export const setDailyScore = (userId: string, day: string, questionId: string, score: number) =>
  request<{ ok: boolean }>(`/daily/student/${userId}/${day}/${questionId}`, json("PUT", { score }), BOARD_TIMEOUT);

// ---- T3: AI 학습 보조 '웰디'와 대화 ----

export type TutorTurn = { q: string; a: string };
export type TutorReply = {
  /** 대화 기록 id (신고할 때) */
  id: string | null;
  /** AI 대답 (비어 있으면 key 를 번역해서 보여 준다) */
  reply: string;
  key: string | null;
  params: Record<string, string | number>;
  /** 근거 쪽 (PDF 쪽, 책에 인쇄된 쪽) */
  pages: { page: number; printed: number }[];
  /** 교재 밖 내용 */
  outside: boolean;
  /** 교재 쪽 열기 */
  open: { page: number; printed: number } | null;
  /** 대화 중 문제 (OX·객관식·단답형) */
  quiz: DailyItem | null;
  book_id: string | null;
  /** 오늘 남은 질문 수 (교육생만) */
  left: number | null;
  /** 전에 누가 한 같은 질문의 저장된 답 (AI 안 씀) */
  cached?: boolean;
  /** 이번에 새로 만들어 문제 은행에 넣은 문제 */
  made?: boolean;
};
export const askTutor = (
  text: string,
  lang: string,
  history: TutorTurn[],
  page?: number,
  lastPages: number[] | null = null,
  seenPage: number | null = null,
) =>
  request<TutorReply>(
    "/tutor/ask",
    json("POST", { text, lang, history, page: page ?? null, last_pages: lastPages, seen_page: seenPage }),
    AI_TIMEOUT,
  );
export type TutorEvent = { t: "delta"; text: string } | { t: "status"; key: string };

/** 웰디 대답을 쓰는 대로 받는다 (첫 문장부터 말하려고). 예전 서버면 한 번에 받는 방식으로. */
export async function askTutorStream(
  text: string,
  lang: string,
  history: TutorTurn[],
  page: number | undefined,
  lastPages: number[] | null,
  onEvent: (e: TutorEvent) => void,
  seenPage: number | null = null,
  ctrl: AbortController = new AbortController(),
): Promise<TutorReply> {
  const started = Date.now();
  let timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT);
  const alive = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT);
  };
  let res: Response;
  try {
    res = await fetch(`${API_URL}/tutor/ask/stream`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ text, lang, history, page: page ?? null, last_pages: lastPages, seen_page: seenPage }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = e as Error;
    const secs = Math.round((Date.now() - started) / 1000);
    const msg = err?.message ?? String(e);
    throw new NetworkError(
      err?.name === "AbortError" || /cancel|abort/i.test(msg) ? `tutor: timeout ${secs}s` : `tutor: network ${secs}s ${msg}`,
    );
  }
  if (res.status === 404 || res.status === 405) {
    clearTimeout(timer);
    return askTutor(text, lang, history, page, lastPages, seenPage); // 아직 예전 서버
  }
  if (!res.ok) {
    clearTimeout(timer);
    const body = await res.text().catch(() => "");
    let detail: { code?: string } | null = null;
    try {
      const d = JSON.parse(body)?.detail;
      if (d && typeof d === "object") detail = d;
    } catch {
      // 본문이 JSON 이 아니면 무시
    }
    if (res.status === 401 && token) onUnauthorized?.();
    throw new NetworkError(`tutor: server ${res.status}`, res.status, detail);
  }
  let done: TutorReply | null = null;
  let buf = "";
  const take = (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of block.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.t === "done") {
            const { t: _t, ...rest } = ev;
            done = rest as TutorReply;
          } else onEvent(ev as TutorEvent);
        } catch {
          // 깨진 줄은 건너뜀
        }
      }
    }
  };
  try {
    const reader = res.body?.getReader?.();
    const Decoder = (globalThis as { TextDecoder?: typeof TextDecoder }).TextDecoder;
    if (reader && Decoder) {
      const dec = new Decoder();
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        alive();
        if (value) take(dec.decode(value, { stream: true }));
      }
      take(dec.decode() + "\n\n");
    } else {
      take((await res.text()) + "\n\n");
    }
  } catch (e) {
    const err = e as Error;
    if (!done) {
      const secs = Math.round((Date.now() - started) / 1000);
      throw new NetworkError(
        err?.name === "AbortError" || /cancel|abort/i.test(err?.message ?? "") ? `tutor: timeout ${secs}s` : `tutor: network ${secs}s`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
  if (!done) throw new NetworkError("tutor: network cut");
  return done;
}
export const answerTutorQuiz = (questionId: string, answer: number | string, lang: string) =>
  request<DailyItem>("/tutor/quiz", json("POST", { question_id: questionId, answer, lang }), BOARD_TIMEOUT);
export const reportTutor = (messageId: string, note = "") =>
  request<{ ok: boolean }>("/tutor/report", json("POST", { message_id: messageId, note }), BOARD_TIMEOUT);
export type TutorReport = {
  id: string;
  name: string;
  question: string;
  answer: string;
  printed: number[];
  report_note: string;
  reported_at: string;
  lang: string;
};
export const listTutorReports = () => request<{ items: TutorReport[] }>("/admin/tutor/reports", {}, BOARD_TIMEOUT);
export const clearTutorReport = (id: string) =>
  request<{ ok: boolean }>(`/admin/tutor/reports/${id}`, { method: "DELETE" }, BOARD_TIMEOUT);
export type TutorFaq = {
  id: string;
  question: string;
  answer: string;
  count: number;
  printed: number[];
  lang: string;
  outside: boolean;
  reported: boolean;
};
export type TutorCheck = {
  id: string;
  question: string;
  page_from: number;
  page_to: number;
  note: string;
  /** ok 맞음 / wrong_page 엉뚱한 쪽 / no_page 근거 쪽 없음 / said_missing "교재에 없다"고 함 / error_* 오류 */
  last_verdict: string;
  last_pages: number[];
  last_found: number[];
  last_reply: string;
  last_run_at: string | null;
  /** 서버가 교재 글로 다시 본 결과 (엉뚱한 쪽·근거 쪽 없음일 때만) */
  hint: { kind: "weldy_right" | "both" | "weldy_wrong" | "elsewhere" | "unclear"; page: number | null } | null;
};
export const listTutorChecks = () => request<{ items: TutorCheck[]; book: string | null }>("/admin/tutor/checks", {}, BOARD_TIMEOUT);
export const addTutorCheck = (question: string, pageFrom: number, pageTo: number) =>
  request<TutorCheck>("/admin/tutor/checks", json("POST", { question, page_from: pageFrom, page_to: pageTo }), BOARD_TIMEOUT);
export const editTutorCheck = (id: string, pageFrom: number, pageTo: number) =>
  request<TutorCheck>(`/admin/tutor/checks/${id}`, json("PATCH", { page_from: pageFrom, page_to: pageTo }), BOARD_TIMEOUT);
export const deleteTutorCheck = (id: string) =>
  request<{ ok: boolean }>(`/admin/tutor/checks/${id}`, { method: "DELETE" }, BOARD_TIMEOUT);
export const seedTutorChecks = () => request<{ added: number }>("/admin/tutor/checks/seed", { method: "POST" }, BOARD_TIMEOUT);
export const runTutorCheck = (id: string) =>
  request<TutorCheck>(`/admin/tutor/checks/${id}/run`, { method: "POST" }, AI_TIMEOUT);
export const listTutorFaq = (days = 30) =>
  request<{ items: TutorFaq[]; days: number }>(`/admin/tutor/faq?days=${days}`, {}, BOARD_TIMEOUT);

// ---- T4(이론): 학습 보드 (모든 사용자) ----

export type BoardSort = "solved" | "score" | "rate";
export type BoardUnit = { unit_key: string; title: string; attempts: number; correct: number; rate: number };
export type BoardRow = {
  user_id: string;
  name: string;
  courses: string[];
  /** 푼 문제 수 (같은 문제는 처음 한 번만) */
  solved: number;
  correct: number;
  /** 문제 하나 10점 만점의 합 */
  score: number;
  /** 정답률 % */
  rate: number;
  /** 매일 문제 / 웰디 대화 중 푼 수 */
  daily: number;
  tutor: number;
  /** 수업 중 돌발 OX */
  live?: number;
  /** 🔥 매일 문제 연속 일수 */
  streak: number;
  /** 정답률 순에서 아직 문제 수가 모자라면 null */
  rank: number | null;
  rank_note?: "need_more";
  weak_unit?: BoardUnit | null;
} & AvatarFields;
export type BoardTopic = {
  topic: string;
  count: number;
  users: number;
  question: string;
  answer: string;
  pages: { page: number; printed: number }[];
};
export type BoardWrong = {
  qid: string;
  attempts: number;
  wrong: number;
  /** 정답률 % */
  rate: number;
  /** 가장 많이 고른 오답 보기 번호 (0부터) */
  top_wrong: number | null;
  top_wrong_n: number;
  item: DailyItem & {
    reveal: { correct_choice: number | null; model_answer: string; explanation: string; tr: { model_answer: string; explanation: string } | null };
  };
};
export type StudyBoard = {
  book: { id: string; title: string } | null;
  hidden?: boolean;
  rows: BoardRow[];
  me: BoardRow | null;
  total: number;
  topics: BoardTopic[];
  /** 아직 주제를 붙이는 중인 질문 수 */
  tagging: number;
  wrong: BoardWrong[];
  units: BoardUnit[];
  min_rate_solved: number;
  min_wrong_users: number;
  /** 이번 주 성장왕 (이번 주 vs 지난주 정답률) */
  growth: BoardGrowth[];
  min_growth: number;
  /** 과정 대항전 */
  courses: BoardCourse[];
  /** 교사·행정·관리자에게만 */
  staff: BoardStaff | null;
};
export type BoardGrowth = { user_id: string; name: string; last_rate: number; this_rate: number; delta: number; solved: number } & AvatarFields;
export type BoardCourse = {
  course_id: string;
  name: string;
  students: number;
  active: number;
  participation: number;
  avg_solved: number;
  avg_rate: number;
  avg_score: number;
};
export type BoardStaff = {
  idle: { user_id: string; name: string; last_day: string | null }[];
  weak: { course_id: string; name: string; units: BoardUnit[] }[];
  tutor_reports: { id: string; question: string; answer: string; report_note: string; reported_at: string }[];
  question_reports: { question_id: string; question: string; book_id: string | null; reason: string; created_at: string }[];
  /** 기간 안 돌발 OX 를 놓친 교육생 (놓친 수 / 낸 수) */
  live_missed?: { user_id: string; name: string; missed: number; total: number }[];
};
export const getStudyBoard = (q: { course: string; period: RankPeriod; sort: BoardSort; lang: string }) =>
  request<StudyBoard>(`/study-board?${new URLSearchParams(q).toString()}`, {}, BOARD_TIMEOUT);
export const getStudyBoardUser = (userId: string, period: RankPeriod) =>
  request<{ units: BoardUnit[] }>(`/study-board/user/${userId}?period=${period}`, {}, BOARD_TIMEOUT);


// ---- 월요일 인사말: 지난주 결산 ----

export type LastWeek = {
  /** 오늘이 월요일(한국 시간)인지 */
  monday: boolean;
  start?: string;
  end?: string;
  /** 교육생 본인 */
  me: {
    solved: number;
    rate: number;
    score: number;
    live: number;
    rank: number | null;
    ranked: number;
    prev_solved: number;
    prev_rate: number | null;
    weak_unit: string | null;
  } | null;
  /** 교사·관리자: 맡은 반 */
  courses: BoardCourse[];
  top: { name: string; solved: number } | null;
};
export const getLastWeek = () => request<LastWeek>("/study-board/last-week", {}, BOARD_TIMEOUT);

// ---- T5 수업 중 돌발 OX ----

const JSON_HEADERS = { "Content-Type": "application/json" };

export type LivePhase = "prep" | "open" | "ended";
/** 교육생 화면 (3초마다) */
export type LiveNow = {
  id: string;
  phase: LivePhase;
  question: string;
  tr: string | null;
  seconds: number;
  /** 남은 초 (열려 있을 때만) */
  left: number | null;
  /** 0 = O, 1 = X */
  my_answer: number | null;
  result: {
    answer: number;
    correct: boolean | null;
    explanation: string;
    tr_explanation: string | null;
    page: number | null;
    printed_page?: number;
    book_id: string | null;
    rate: number;
    answered: number;
    explain_status: "none" | "making" | "ready" | "failed";
    explain: string | null;
  } | null;
};
export const getLiveNow = (lang: string) => request<{ quiz: LiveNow | null }>(`/live/now?lang=${lang}`, {}, 8000);
export const answerLive = (quiz_id: string, answer: number) =>
  request<{ ok: boolean }>("/live/answer", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ quiz_id, answer }) }, 8000);

/** 교사 실시간 화면 */
export type LiveTeacher = {
  id: string;
  course_id: string;
  phase: LivePhase;
  question: string;
  answer: number;
  explanation: string;
  page: number | null;
  seconds: number;
  left: number | null;
  targets: number;
  answered: number;
  o: number;
  x: number;
  /** 아직 안 답한 교육생 이름 */
  waiting: string[];
  /** 끝난 뒤 틀린 교육생 이름 */
  wrong: string[];
  stats: { answered: number; correct: number; targets: number; rate: number } | null;
  explain_status: "none" | "making" | "ready" | "failed";
  explain: string | null;
};
export type LiveBankItem = {
  id: string;
  question: string;
  answer: number;
  explanation: string;
  unit_title: string;
  page: number | null;
  printed_page: number | null;
};
export type LiveSetup = {
  courses: Course[];
  book: { id: string; title: string } | null;
  units: { unit_key: string; title: string; ox: number }[];
  seconds: number[];
  default_seconds: number;
  /** 반 id → 지금 열려 있는 문제 id */
  live: Record<string, string>;
};
export type LiveHistoryItem = {
  id: string;
  question: string;
  answer: number;
  seconds: number;
  started_at: string;
  ended_at: string | null;
  answered: number;
  correct: number;
  targets: number;
  rate: number | null;
  explain: string;
};
const post = <T>(path: string, body: unknown = {}, timeout = 30000) =>
  request<T>(path, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }, timeout);
export const getLiveSetup = () => request<LiveSetup>("/live/setup");
export const pickLive = (body: { course_id: string; unit_key: string; exclude: string[]; make?: boolean }) =>
  post<{ question: LiveBankItem | null; left?: number; made?: boolean; can_make?: boolean }>("/live/pick", body, 90000);
export const getLiveBank = (unitKey: string) => request<{ items: LiveBankItem[] }>(`/live/bank?unit_key=${encodeURIComponent(unitKey)}`);
export const startLive = (body: { course_id: string; question_id?: string; text?: string; answer?: number; seconds: number }) =>
  post<{ quiz: LiveTeacher }>("/live/start", body);
export const getLiveStatus = (id: string) => request<{ quiz: LiveTeacher }>(`/live/status/${id}`, {}, 8000);
export const endLive = (id: string) => post<{ quiz: LiveTeacher }>(`/live/end/${id}`);
export const explainLive = (id: string) => post<{ quiz: LiveTeacher }>(`/live/explain/${id}`);
export const getLiveHistory = (courseId: string) =>
  request<{ day: string; items: LiveHistoryItem[] }>(`/live/history?course_id=${courseId}`);
