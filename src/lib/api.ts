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

export type EngineResult = {
  status: Status;
  warnings?: string[];
  bead?: {
    length_mm: number;
    width: { mean_mm: number; min_mm: number; max_mm: number; std_mm: number };
    straightness: { max_dev_mm: number };
  };
  defects?: { type: string; length_mm: number | null; confidence: number }[];
};

export type Submission = SubmissionSummary & {
  result: EngineResult | null;
  photo_url: string | null;
  check_url: string | null;
};

/** 실패 원인 코드. 화면 문구 끝에 함께 보여 줘서 원인을 구분한다. */
export class NetworkError extends Error {
  constructor(public code: string) {
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
    throw new NetworkError(`${step}: server ${res.status}`);
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
): Promise<Submission> {
  const form = new FormData();
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

export async function listSubmissions(): Promise<SubmissionSummary[]> {
  const id = encodeURIComponent(await getDeviceId());
  return request<SubmissionSummary[]>(`/submissions?device_id=${id}`, {}, 90000);
}

export async function getSubmission(sid: string): Promise<Submission> {
  const id = encodeURIComponent(await getDeviceId());
  return request<Submission>(`/submissions/${sid}?device_id=${id}`, {}, 90000);
}

/** 상태 코드 → 번역 키 */
export function statusKey(s: Status): string {
  if (s === "processing") return "status_processing";
  if (s === "marker_not_found" || s === "no_bead" || s === "roboflow_failed") return `status_${s}`;
  return "status_error";
}
