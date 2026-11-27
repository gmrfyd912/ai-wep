import { useMemo } from "react";
import Svg, { Circle, G, Line, Polygon, Rect, Text as SvgText } from "react-native-svg";

import type { GameBuilding, GameShipKind } from "@/lib/api";

/** 건물 색 (화면 범례와 같음) */
export const BUILDING_COLOR: Record<string, string> = {
  hq: "#2F5F9E",
  yard: "#8FA3B8",
  rodstore: "#F2A516",
  cutting: "#5B8BB5",
  welding: "#E07B39",
  academy: "#7A5FB0",
  dock: "#2B7FBF",
};
export const RES_COLOR = { steel: "#8FA3B8", rods: "#F2A516", tech: "#57C4E5", passes: "#E05A9B", fame: "#FFD166" };
const BASE_H: Record<string, number> = { hq: 1.5, yard: 0.5, rodstore: 0.7, cutting: 0.9, welding: 1.0, academy: 1.1, dock: 0 };
const WATER_COLS = 2;

type Pt = [number, number];

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const pts = (a: Pt[]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

/** 지도 크기: 칸 너비 W 에서 전체 너비·높이 */
export function mapSize(grid: number, W: number) {
  return { width: (grid + WATER_COLS + 0.6) * W, height: (grid / 2 + 3.6) * W };
}

/**
 * 조선소 지도 (비스듬히 내려다보는 2D, react-native-svg — Expo Go·웹 모두 됨).
 * - 건물을 누르면 onSelect, 놓기 모드(place)면 놓을 수 있는 칸이 초록으로 보이고 누르면 onPlace.
 * - 글자는 짧은 이름·레벨만 (자세한 설명은 아래 칸).
 */
export function GameMap({
  grid,
  W,
  buildings,
  selected,
  labels,
  place,
  ship,
  onSelect,
  onPlace,
  now,
}: {
  grid: number;
  W: number;
  buildings: GameBuilding[];
  selected: string | null;
  labels: Record<string, string>;
  /** 놓기 모드: 놓을 건물 크기·추천 자리·지금 고른 자리 */
  place: { w: number; h: number; skipId?: string; hint?: { x: number; y: number } | null; pick?: { x: number; y: number } | null; color: string } | null;
  ship: { kind: GameShipKind; stage: number } | null;
  onSelect: (id: string | null) => void;
  onPlace: (x: number, y: number) => void;
  /** 화면 글자: 남은 시간 등 */
  now: { left: (b: GameBuilding) => string | null; done: string };
}) {
  const H = W / 2;
  const { width, height } = mapSize(grid, W);
  const ox = (grid / 2 + 0.3) * W;
  const oy = 2.6 * W;
  const P = (x: number, y: number): Pt => [ox + ((x - y) * W) / 2, oy + ((x + y) * H) / 2];

  const box = (x: number, y: number, w: number, h: number, z: number, color: string, key: string) => {
    const A = P(x, y), B = P(x + w, y), C = P(x + w, y + h), D = P(x, y + h);
    const up = (p: Pt): Pt => [p[0], p[1] - z];
    return (
      <G key={key}>
        <Polygon points={pts([D, C, up(C), up(D)])} fill={shade(color, 0.78)} stroke="#0003" strokeWidth={0.6} />
        <Polygon points={pts([B, C, up(C), up(B)])} fill={shade(color, 0.6)} stroke="#0003" strokeWidth={0.6} />
        <Polygon points={pts([up(A), up(B), up(C), up(D)])} fill={shade(color, 1.1)} stroke="#0003" strokeWidth={0.6} />
      </G>
    );
  };

  const occupied = useMemo(() => {
    const s = new Set<string>();
    for (const b of buildings) {
      if (place?.skipId === b.id) continue;
      for (let i = 0; i < b.w; i++) for (let j = 0; j < b.h; j++) s.add(`${b.x + i},${b.y + j}`);
    }
    return s;
  }, [buildings, place?.skipId]);

  const fits = (x: number, y: number) => {
    if (!place) return false;
    if (x + place.w > grid || y + place.h > grid) return false;
    for (let i = 0; i < place.w; i++) for (let j = 0; j < place.h; j++) if (occupied.has(`${x + i},${y + j}`)) return false;
    return true;
  };

  // 땅·바다
  const ground: React.ReactNode[] = [];
  for (let x = 0; x < grid + WATER_COLS; x++)
    for (let y = 0; y < grid; y++) {
      const water = x >= grid;
      const ok = !water && fits(x, y);
      const corners = [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)];
      ground.push(
        <Polygon
          key={`t${x}-${y}`}
          points={pts(corners)}
          fill={water ? "#2B7FBF" : ok ? ((x + y) % 2 ? "#7FD18F" : "#73C985") : (x + y) % 2 ? "#C8C2B4" : "#BFB8A9"}
          stroke={water ? "#2B7FBF" : "#00000014"}
          strokeWidth={0.5}
          onPress={place ? () => ok && onPlace(x, y) : () => onSelect(null)}
        />,
      );
    }

  // 방파제 (아래쪽 가장자리)
  const wall: React.ReactNode[] = [];
  for (let x = 0; x < grid; x++) wall.push(box(x, grid - 0.35, 1, 0.35, 0.28 * W, "#7D7D7D", `w${x}`));

  const tagInfo: { b: GameBuilding; sel: boolean; cx: number; y: number }[] = [];
  const sorted = [...buildings].sort((a, b) => a.x + a.w + a.y + a.h - (b.x + b.w + b.y + b.h));
  const items = sorted.map((b) => {
    const color = BUILDING_COLOR[b.type] ?? "#999";
    const sel = selected === b.id;
    const lv = Math.max(b.level, 1);
    const z = (BASE_H[b.type] + lv * 0.12) * W;
    const parts: React.ReactNode[] = [];
    if (b.type === "dock") {
      // 도크: 물 + 크레인 기둥 + 배
      const A = P(b.x, b.y), B = P(b.x + b.w, b.y), C = P(b.x + b.w, b.y + b.h), D = P(b.x, b.y + b.h);
      parts.push(<Polygon key="pool" points={pts([A, B, C, D])} fill="#1F6FA8" stroke="#555" strokeWidth={2} />);
      if (ship) {
        const len = [1.2, 2.2, 3.2, 4.4, 4.4][ship.stage] ?? 4.4;
        const hullY = b.y + 0.3;
        if (ship.stage <= 1) {
          for (let k = 0; k < ship.stage + 2; k++) parts.push(box(b.x + 0.5, hullY + k * 1.1, 1, 0.9, 0.25 * W, "#B33B2E", `blk${k}`));
        } else {
          parts.push(box(b.x + 0.3, hullY, 1.4, len, 0.35 * W, "#B33B2E", "hull"));
          parts.push(box(b.x + 0.35, hullY + 0.1, 1.3, len - 0.2, 0.16 * W, "#34495E", "deck"));
          if (ship.stage >= 3) parts.push(box(b.x + 0.5, hullY + len - 1.1, 1, 0.9, 0.75 * W, "#F0F0F0", "house"));
        }
      }
      const c1 = P(b.x - 0.2, b.y + b.h + 0.2), c2 = P(b.x + b.w + 0.3, b.y + b.h + 0.2);
      const ch = 2.4 * W;
      parts.push(
        <G key="crane">
          <Rect x={c1[0] - 2} y={c1[1] - ch} width={4} height={ch} fill="#F2C230" />
          <Rect x={c2[0] - 2} y={c2[1] - ch} width={4} height={ch} fill="#F2C230" />
          <Polygon points={pts([[c1[0], c1[1] - ch], [c2[0], c2[1] - ch], [c2[0], c2[1] - ch - 6], [c1[0], c1[1] - ch - 6]])} fill="#F2C230" stroke="#0004" />
        </G>,
      );
    } else if (b.level === 0) {
      // 새로 짓는 중: 비계(뼈대)
      parts.push(box(b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, 0.12 * W, "#9B8F7A", "base"));
      const A = P(b.x + 0.2, b.y + b.h - 0.2), C = P(b.x + b.w - 0.2, b.y + b.h - 0.2);
      parts.push(<Line key="sc1" x1={A[0]} y1={A[1]} x2={A[0]} y2={A[1] - 0.8 * W} stroke="#F2C230" strokeWidth={2} />);
      parts.push(<Line key="sc2" x1={C[0]} y1={C[1]} x2={C[0]} y2={C[1] - 0.8 * W} stroke="#F2C230" strokeWidth={2} />);
      parts.push(<Line key="sc3" x1={A[0]} y1={A[1] - 0.8 * W} x2={C[0]} y2={C[1] - 0.8 * W} stroke="#F2C230" strokeWidth={2} />);
    } else {
      parts.push(box(b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, z, color, "body"));
      if (b.type === "hq") {
        const t = P(b.x + b.w / 2, b.y + b.h / 2);
        parts.push(<Line key="pole" x1={t[0]} y1={t[1] - z} x2={t[0]} y2={t[1] - z - 0.9 * W} stroke="#eee" strokeWidth={1.5} />);
        parts.push(<Rect key="flag" x={t[0]} y={t[1] - z - 0.9 * W} width={0.45 * W} height={0.28 * W} fill="#FF8A1F" />);
      }
      if (b.type === "cutting" || b.type === "welding") parts.push(box(b.x + b.w - 0.6, b.y + 0.3, 0.3, 0.3, z + 0.6 * W, "#6B6B6B", "chim"));
    }
    if (sel) {
      const A = P(b.x, b.y), B = P(b.x + b.w, b.y), C = P(b.x + b.w, b.y + b.h), D = P(b.x, b.y + b.h);
      parts.unshift(<Polygon key="sel" points={pts([A, B, C, D])} fill="#FFFFFF33" stroke="#FFFFFF" strokeWidth={2} />);
    }
    // 이름표는 아래에서 따로 맨 위 층에 그린다 (건물에 가리거나 서로 겹치지 않게)
    const top = P(b.x + b.w / 2, b.y + b.h / 2);
    tagInfo.push({ b, sel, cx: top[0], y: top[1] - (b.type === "dock" ? 0.4 * W : z) - 8 });
    return (
      <G key={b.id} onPress={place ? undefined : () => onSelect(b.id)}>
        {parts}
      </G>
    );
  });

  // 이름표·남은 시간·받을 생산분: 앞쪽 건물부터 자리를 잡고, 겹치면 위로 올린다
  const fs = Math.max(9, Math.min(12, W * 0.42));
  const taken: { x1: number; x2: number; y1: number; y2: number }[] = [];
  const hit = (r: { x1: number; x2: number; y1: number; y2: number }) =>
    taken.some((o) => r.x1 < o.x2 && r.x2 > o.x1 && r.y1 < o.y2 && r.y2 > o.y1);
  const tags = [...tagInfo]
    .sort((a, b) => b.y - a.y)
    .map(({ b, sel, cx, y }) => {
      const label = labels[b.type] + (b.type === "dock" || b.level === 0 ? "" : ` ${b.level}`);
      const tw = label.length * fs * 0.95 + 10;
      const left = now.left(b);
      const chip = left ?? (b.just_done ? now.done : null);
      const cw = chip ? chip.length * fs * 0.75 + 12 : 0;
      const coin = !chip && b.pending > 0;
      const half = Math.max(tw, cw) / 2 + (coin ? fs * 1.6 + 6 : 0);
      const blockH = (chip ? 2 * fs + 12 : fs + 6) + 2;
      let tagY = y;
      for (let k = 0; k < 8; k++) {
        const r = { x1: cx - half, x2: cx + half, y1: tagY - blockH, y2: tagY + 6 };
        if (!hit(r)) break;
        tagY -= fs + 8;
      }
      taken.push({ x1: cx - half, x2: cx + half, y1: tagY - blockH, y2: tagY + 6 });
      return (
        <G key={`tag-${b.id}`} onPress={place ? undefined : () => onSelect(b.id)}>
          {tagY < y - 2 && <Line x1={cx} y1={tagY + 4} x2={cx} y2={y + 4} stroke="#0B2033AA" strokeWidth={1.2} />}
          <Rect x={cx - tw / 2} y={tagY - fs - 2} width={tw} height={fs + 6} rx={(fs + 6) / 2} fill={sel ? "#FF8A1F" : "#0B2033D9"} />
          <SvgText x={cx} y={tagY + 1} fontSize={fs} fill="#fff" textAnchor="middle">
            {label}
          </SvgText>
          {chip && (
            <G>
              <Rect x={cx - cw / 2} y={tagY - 2 * fs - 8} width={cw} height={fs + 6} rx={(fs + 6) / 2} fill={left ? "#0B2033" : "#2E9D5B"} />
              <SvgText x={cx} y={tagY - fs - 5} fontSize={fs} fill={left ? "#FFD166" : "#fff"} textAnchor="middle">
                {chip}
              </SvgText>
            </G>
          )}
          {coin && (
            <Circle cx={cx + tw / 2 + 6} cy={tagY - fs / 2} r={fs * 0.75} fill={b.type === "cutting" ? RES_COLOR.steel : RES_COLOR.rods} stroke="#fff" strokeWidth={1.5} />
          )}
        </G>
      );
    });

  // 놓기 모드: 고른 자리(또는 추천 자리) 미리보기
  let ghost: React.ReactNode = null;
  const g = place?.pick ?? null;
  if (place && g) ghost = <G opacity={0.75}>{box(g.x + 0.1, g.y + 0.1, place.w - 0.2, place.h - 0.2, 0.6 * W, place.color, "ghost")}</G>;
  let hint: React.ReactNode = null;
  if (place?.hint && !g) {
    const A = P(place.hint.x, place.hint.y), B = P(place.hint.x + place.w, place.hint.y);
    const C = P(place.hint.x + place.w, place.hint.y + place.h), D = P(place.hint.x, place.hint.y + place.h);
    hint = <Polygon points={pts([A, B, C, D])} fill="#FFE27A" stroke="#fff" strokeWidth={2.5} strokeDasharray="5 4" onPress={() => onPlace(place.hint!.x, place.hint!.y)} />;
  }

  return (
    <Svg width={width} height={height}>
      <Rect x={0} y={0} width={width} height={height} fill="#1F6FA8" onPress={() => !place && onSelect(null)} />
      {ground}
      {hint}
      {wall}
      {items}
      {ghost}
      {tags}
    </Svg>
  );
}
