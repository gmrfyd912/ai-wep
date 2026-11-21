import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

// 분석 서버 주소 (비밀 아님). app.json 의 expo.extra.apiUrl 에서 읽는다.
export const API_URL: string =
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ?? "https://ai-wep-server.onrender.com";

const DEVICE_KEY = "aiwep.deviceId";

/** 로그인 전(6단계 전) 임시 번호: 휴대폰마다 한 번 만들어 저장한다. */
export async function getDeviceId(): Promise<string> {
  const saved = await AsyncStorage.getItem(DEVICE_KEY);
  if (saved) return saved;
  const hex = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
  const id = `${hex()}${hex()}-${hex()}-${hex()}-${hex()}-${hex()}${hex()}${hex()}`;
  await AsyncStorage.setItem(DEVICE_KEY, id);
  return id;
}

export type Status = "ok" | "processing" | "marker_not_found" | "no_bead" | "roboflow_failed" | string;

export type SubmissionSummary = {
  id: string;
  status: Status;
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
};

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
      /** [시작에서 거리 mm, 폭 mm] 1mm마다 (양 끝 구간 포함) */
      profile?: [number, number][];
    };
    straightness: {
      max_dev_mm: number;
      max_dev_pos_mm?: number;
      /** [시작에서 거리 mm, 기준선 대비 이탈 mm] 1mm마다. 4단계 이전 결과에는 없음 */
      profile?: [number, number][];
    };
  };
  defects?: { type: string; length_mm: number | null; confidence: number; pos_along_bead_mm?: number | null }[];
};

export type Submission = SubmissionSummary & {
  score?: ScoreInfo | null;
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
    public detail: { code?: string; limit?: number } | null = null,
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
    res = await fetch(`${API_URL}${path}`, { ...init, signal: ctrl.signal });
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
    let detail: { code?: string; limit?: number } | null = null;
    try {
      const d = JSON.parse(body)?.detail;
      if (d && typeof d === "object") detail = d;
    } catch {
      // 본문이 JSON 이 아니면 무시
    }
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
  info: { process: string; position: string; material: string },
  opts: { jobId?: string; onUploadProgress?: (ratio: number) => void } = {},
): Promise<Submission> {
  const form = new FormData();
  if (opts.jobId) form.append("job_id", opts.jobId);
  form.append("device_id", await getDeviceId());
  form.append("process", info.process);
  form.append("position", info.position);
  form.append("material", info.material);
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
  const id = encodeURIComponent(await getDeviceId());
  return request<SubmissionListItem[]>(`/submissions?device_id=${id}`, {}, 90000);
}

export async function getSubmission(sid: string): Promise<Submission> {
  const id = encodeURIComponent(await getDeviceId());
  return request<Submission>(`/submissions/${sid}?device_id=${id}`, {}, 90000);
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
