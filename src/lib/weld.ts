import AsyncStorage from "@react-native-async-storage/async-storage";

/** 용접법·자세 목록 (업로드·갤러리·랭킹 공통) */
export const PROCESSES = ["SMAW", "GTAW", "GMAW", "FCAW"] as const;

/** 6-5: 평판/배관. 평판·배관 기록은 섞지 않는다 (예전 기록 = 평판) */
export type WorkType = "plate" | "pipe";
export const WORK_TYPES: WorkType[] = ["plate", "pipe"];
export const PLATE_POSITIONS = ["1G", "2G", "3G", "4G", "1F", "2F", "3F", "4F"] as const;
export const PIPE_POSITIONS = ["1G", "2G", "5G", "6G", "6GR", "1F", "2F", "4F", "5F"] as const;
/** 평판·배관을 합친 자세 목록 (갤러리 '전체'일 때) */
export const POSITIONS = [...new Set<string>([...PLATE_POSITIONS, ...PIPE_POSITIONS])];

export const positionsOf = (w: WorkType | ""): readonly string[] =>
  w === "pipe" ? PIPE_POSITIONS : w === "plate" ? PLATE_POSITIONS : POSITIONS;

/** 배관 외경 규격표 (예전 앱과 같은 값). 250A·300A 만 일반 강관과 STS 외경이 다르다 */
export const PIPE_OD_TABLE = [
  { a: "25A", b: '1"', od: 34.0, ods: 34.0 },
  { a: "32A", b: '1 1/4"', od: 42.7, ods: 42.7 },
  { a: "40A", b: '1 1/2"', od: 48.6, ods: 48.6 },
  { a: "50A", b: '2"', od: 60.5, ods: 60.5 },
  { a: "65A", b: '2 1/2"', od: 76.3, ods: 76.3 },
  { a: "80A", b: '3"', od: 89.1, ods: 89.1 },
  { a: "90A", b: '3 1/2"', od: 101.6, ods: 101.6 },
  { a: "100A", b: '4"', od: 114.3, ods: 114.3 },
  { a: "125A", b: '5"', od: 139.8, ods: 139.8 },
  { a: "150A", b: '6"', od: 165.2, ods: 165.2 },
  { a: "200A", b: '8"', od: 216.3, ods: 216.3 },
  { a: "250A", b: '10"', od: 267.4, ods: 273.0 },
  { a: "300A", b: '12"', od: 318.5, ods: 323.9 },
] as const;

// 마지막으로 올린 종류 (랭킹·갤러리 첫 화면, 다음 업로드 기본값)
const KEY = "aiwep.lastWorkType";
let last: WorkType | null = null;

export async function getLastWorkType(): Promise<WorkType> {
  if (last) return last;
  try {
    const v = await AsyncStorage.getItem(KEY);
    last = v === "pipe" ? "pipe" : "plate";
  } catch {
    last = "plate";
  }
  return last;
}

export function setLastWorkType(w: WorkType) {
  last = w;
  AsyncStorage.setItem(KEY, w).catch(() => {});
}
