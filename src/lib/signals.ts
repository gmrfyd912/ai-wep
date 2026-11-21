/** 항목별 신호등 기준 (박사 확정 2026-11-21). 기준을 바꿀 때는 이 파일만 고치면 된다. */
export const SIGNAL_RULES = {
  /** 폭 균일성 = 검사구간 최대폭 − 최소폭 (mm) */
  widthRange: { green: 1.5, yellow: 3 },
  /** 직진도 = 기준선 대비 최대 이탈 (mm) */
  straight: { green: 1, yellow: 2 },
  /** 결함 = 검사구간 결함 개수. 균열은 1개라도 빨강 */
  defects: { green: 0, yellow: 2 },
} as const;

export type Signal = "green" | "yellow" | "red";

export const SIGNAL_COLORS: Record<Signal, string> = {
  green: "#22C55E",
  yellow: "#F59E0B",
  red: "#EF4444",
};

function byLimit(v: number, r: { green: number; yellow: number }): Signal {
  if (v <= r.green) return "green";
  if (v <= r.yellow) return "yellow";
  return "red";
}

export function widthSignal(min?: number | null, max?: number | null): Signal | null {
  if (min == null || max == null) return null;
  return byLimit(Number(max) - Number(min), SIGNAL_RULES.widthRange);
}

export function straightSignal(maxDev?: number | null): Signal | null {
  return maxDev == null ? null : byLimit(Number(maxDev), SIGNAL_RULES.straight);
}

export const isCrack = (type?: string | null) => !!type && type.toLowerCase().includes("crack");

export function defectSignal(types: (string | null | undefined)[] | null | undefined): Signal | null {
  if (types == null) return null;
  if (types.some(isCrack)) return "red";
  return byLimit(types.length, SIGNAL_RULES.defects);
}
