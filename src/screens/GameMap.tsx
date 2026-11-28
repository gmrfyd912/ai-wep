import { useEffect, useMemo, useState } from "react";
import Svg, { Circle, Ellipse, G, Line, Polygon, Rect, Text as SvgText } from "react-native-svg";

import type { GameBuilding, GameShipKind, GameWarKind } from "@/lib/api";

/** 건물 색 (화면 범례와 같음) */
export const BUILDING_COLOR: Record<string, string> = {
  hq: "#2F5F9E",
  yard: "#8FA3B8",
  rodstore: "#F2A516",
  cutting: "#5B8BB5",
  welding: "#E07B39",
  academy: "#7A5FB0",
  dock: "#2B7FBF",
  pier: "#8A6A47",
  battery: "#6B7A4F",
  missile: "#A0453F",
  mine: "#D0342C",
  asw: "#3E8582",
  radar: "#B9BFD0",
  wall: "#8E8E8E",
  trainhall: "#C2577A",
  dorm: "#5FA36B",
  garage: "#C98E3A",
};
/** 방어 시설 (지도에 이름표 대신 레벨만 작게: 장벽·기뢰는 많아서 이름표 생략) */
const NO_TAG = new Set(["wall", "mine"]);
/** 전투함 회색 (상선은 빨간 배) */
export const WAR_COLOR = "#6F7C8A";
export const RES_COLOR = { steel: "#8FA3B8", rods: "#F2A516", tech: "#57C4E5", passes: "#E05A9B", fame: "#FFD166" };
const BASE_H: Record<string, number> = {
  hq: 1.5, yard: 0.5, rodstore: 0.7, cutting: 0.9, welding: 1.0, academy: 1.1, dock: 0, pier: 0.25,
  battery: 0.35, missile: 0.3, mine: 0, asw: 0.6, radar: 0.3, wall: 0.4,
  trainhall: 1.0, dorm: 1.2, garage: 0.8,
};

type Pt = [number, number];

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const pts = (a: Pt[]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

/** 지도 크기: 칸 너비 W 에서 전체 너비·높이 */
export function mapSize(grid: number, W: number, sea = 2) {
  return { width: (grid + sea + 0.6) * W, height: (grid / 2 + 3.6) * W };
}

/**
 * 조선소 지도 (비스듬히 내려다보는 2D, react-native-svg — Expo Go·웹 모두 됨).
 * - 건물을 누르면 onSelect, 놓기 모드(place)면 놓을 수 있는 칸이 초록으로 보이고 누르면 onPlace.
 * - 글자는 짧은 이름·레벨만 (자세한 설명은 아래 칸).
 */
export function GameMap({
  grid,
  sea = 2,
  reclaiming = false,
  fleet = [],
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
  /** 바다 줄 수 */
  sea?: number;
  /** 간척 공사 중: 새로 생길 땅을 메우는 모습 */
  reclaiming?: boolean;
  /** 군항 부두에 정박한 전투함 (오래된 것부터) */
  fleet?: GameWarKind[];
  W: number;
  buildings: GameBuilding[];
  selected: string | null;
  labels: Record<string, string>;
  /** 놓기 모드: 놓을 건물 크기·추천 자리·지금 고른 자리 */
  place: {
    w: number; h: number; coast?: boolean;
    /** 바다에 놓는 것 (기뢰밭·방파 장벽, 배가 드나드는 물길 빼고) */
    sea?: boolean;
    skipId?: string; hint?: { x: number; y: number } | null; pick?: { x: number; y: number } | null; color: string;
  } | null;
  ship: { kind: GameShipKind | GameWarKind; stage: number; war?: boolean } | null;
  onSelect: (id: string | null) => void;
  onPlace: (x: number, y: number) => void;
  /** 화면 글자: 남은 시간 등 */
  now: { left: (b: GameBuilding) => string | null; done: string };
}) {
  const H = W / 2;
  const WATER_COLS = sea;
  const { width, height } = mapSize(grid, W, sea);
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

  // 배가 드나드는 물길 (도크 앞 한 줄, 군항 부두 옆 두 줄): 기뢰·장벽을 못 놓음
  const berth = useMemo(() => {
    const s = new Set<string>();
    for (const b of buildings) {
      if (b.type === "dock") for (let j = 0; j < b.h; j++) s.add(`${grid},${b.y + j}`);
      if (b.type === "pier") for (let i = 0; i < 2; i++) for (let j = 0; j < b.h; j++) s.add(`${grid + i},${b.y + j}`);
    }
    return s;
  }, [buildings, grid]);

  const fits = (x: number, y: number) => {
    if (!place) return false;
    if (y + place.h > grid) return false;
    if (place.sea) {
      if (x < grid || x + place.w > grid + WATER_COLS) return false;
      for (let i = 0; i < place.w; i++) for (let j = 0; j < place.h; j++) {
        const k = `${x + i},${y + j}`;
        if (occupied.has(k) || berth.has(k)) return false;
      }
      return true;
    }
    if (x + place.w > grid) return false;
    if (place.coast && x + place.w !== grid) return false;
    for (let i = 0; i < place.w; i++) for (let j = 0; j < place.h; j++) if (occupied.has(`${x + i},${y + j}`)) return false;
    return true;
  };

  // 땅·바다
  const ground: React.ReactNode[] = [];
  for (let x = 0; x < grid + WATER_COLS; x++)
    for (let y = 0; y < grid; y++) {
      const water = x >= grid;
      const ok = fits(x, y);
      const corners = [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)];
      ground.push(
        <Polygon
          key={`t${x}-${y}`}
          points={pts(corners)}
          fill={ok ? ((x + y) % 2 ? "#7FD18F" : "#73C985") : water ? "#2B7FBF" : (x + y) % 2 ? "#C8C2B4" : "#BFB8A9"}
          stroke={water && !ok ? "#2B7FBF" : "#00000014"}
          strokeWidth={0.5}
          onPress={place ? () => ok && onPlace(x, y) : () => onSelect(null)}
        />,
      );
    }

  // 간척 중: 새로 생길 땅(오른쪽 2줄·아래 2줄)을 모래로 메우는 중
  const fill: React.ReactNode[] = [];
  if (reclaiming) {
    for (let x = 0; x < grid + 2; x++)
      for (let y = 0; y < grid + 2; y++) {
        if (x < grid && y < grid) continue;
        if (x >= grid + WATER_COLS) continue;
        const corners = [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)];
        fill.push(<Polygon key={`f${x}-${y}`} points={pts(corners)} fill={(x + y) % 2 ? "#D9C08A" : "#CFB57D"} stroke="#0000001A" strokeWidth={0.5} opacity={0.5} />);
      }
    // 모래를 뿜는 준설선 + 작업 반장
    const dx = grid + 0.6, dy = Math.max(1, grid - 4);
    fill.push(box(dx, dy, 1.1, 1.6, 0.3 * W, "#E0A526", "dredge"));
    fill.push(box(dx + 0.2, dy + 0.9, 0.6, 0.5, 0.8 * W, "#F2F2F2", "dredgeHouse"));
    const a = P(dx + 0.5, dy + 0.2), b = P(grid - 0.2, dy - 1.2);
    fill.push(<Line key="pipe" x1={a[0]} y1={a[1] - 0.3 * W} x2={b[0]} y2={b[1]} stroke="#555" strokeWidth={3} />);
    fill.push(<Circle key="spray" cx={b[0]} cy={b[1]} r={0.35 * W} fill="#D9C08A" opacity={0.9} />);
    fill.push(<Foreman key="rf" from={P(grid + 0.3, grid + 1.4)} to={P(1, grid + 1.4)} size={W * 0.62} offset={777} />);
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
      const hullC = ship?.war ? WAR_COLOR : "#B33B2E";
      if (ship) {
        const len = [1.2, 2.2, 3.2, 4.4, 4.4][ship.stage] ?? 4.4;
        const hullY = b.y + 0.3;
        if (ship.stage <= 1) {
          for (let k = 0; k < ship.stage + 2; k++) parts.push(box(b.x + 0.5, hullY + k * 1.1, 1, 0.9, 0.25 * W, hullC, `blk${k}`));
        } else {
          parts.push(box(b.x + 0.3, hullY, 1.4, len, 0.35 * W, hullC, "hull"));
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
    } else if (b.type === "pier" && b.level > 0) {
      // 군항 부두: 낮은 잔교 + 계류 기둥, 옆 바다에 전투함이 나란히 정박
      parts.push(box(b.x + 0.1, b.y + 0.05, b.w - 0.1, b.h - 0.1, 0.22 * W, color, "deck"));
      for (let k = 0; k < b.h; k++) parts.push(box(b.x + b.w - 0.3, b.y + k + 0.4, 0.15, 0.15, 0.45 * W, "#333", `bol${k}`));
      fleet.slice(0, 6).forEach((kind, i) => {
        const col = Math.floor(i / b.h), row = i % b.h;
        const sx = b.x + b.w + 0.1 + col * 1.05, sy = b.y + row + 0.2;
        const len = kind === "landing" ? 1.0 : kind === "frigate" ? 0.95 : 0.75;
        parts.push(box(sx, sy, len, 0.55, 0.22 * W, WAR_COLOR, `ws${i}`));
        parts.push(box(sx + 0.05, sy + 0.05, len - 0.1, 0.45, 0.1 * W, "#4A5561", `wd${i}`));
        if (kind === "landing") {
          // 상륙함: 넓고 평평한 갑판 + 뒤쪽 낮은 함교 + 앞쪽 내림 문(노란 줄)
          parts.push(box(sx + 0.05, sy + 0.1, 0.22, 0.35, 0.4 * W, "#C9D1D9", `wh${i}`));
          parts.push(box(sx + len - 0.12, sy + 0.08, 0.07, 0.39, 0.26 * W, "#F2C230", `wr${i}`));
        } else {
          parts.push(box(sx + len * 0.35, sy + 0.12, 0.28, 0.3, 0.42 * W, "#C9D1D9", `wh${i}`));
        }
      });
    } else if (b.type === "mine" && b.level > 0) {
      // 기뢰밭: 물 위에 뜬 빨간 기뢰 3개 (레벨이 오르면 조금 커짐)
      const r = W * (0.12 + lv * 0.01);
      [[0.3, 0.3], [0.7, 0.45], [0.4, 0.75]].forEach(([dx, dy], i) => {
        const c = P(b.x + dx, b.y + dy);
        parts.push(<Line key={`ms${i}`} x1={c[0] - r * 1.4} y1={c[1] - r * 0.6} x2={c[0] + r * 1.4} y2={c[1] - r * 0.6} stroke="#222" strokeWidth={1} />);
        parts.push(<Circle key={`m${i}`} cx={c[0]} cy={c[1] - r * 0.6} r={r} fill={color} stroke="#3A0D0A" strokeWidth={1} />);
      });
    } else if (b.type === "wall" && b.level > 0) {
      // 방파 장벽: 바다 속 콘크리트 블록 (레벨이 오르면 높아짐)
      parts.push(box(b.x + 0.05, b.y, 0.9, 1, (0.3 + lv * 0.08) * W, color, "wall"));
    } else if (b.type === "battery" && b.level > 0) {
      // 해안포대: 낮은 진지 + 포탑 + 바다 쪽으로 향한 포신
      parts.push(box(b.x + 0.1, b.y + 0.1, 0.8, 0.8, z * 0.6, color, "base"));
      parts.push(box(b.x + 0.25, b.y + 0.25, 0.5, 0.5, z, shade(color, 1.15), "turret"));
      const a = P(b.x + 0.6, b.y + 0.5), e = P(b.x + 1.35, b.y + 0.5);
      parts.push(<Line key="barrel" x1={a[0]} y1={a[1] - z * 0.85} x2={e[0]} y2={e[1] - z * 0.95} stroke="#2E3324" strokeWidth={3} />);
    } else if (b.type === "missile" && b.level > 0) {
      // 미사일 기지: 넓은 받침 + 비스듬히 선 발사관 두 개
      parts.push(box(b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, z * 0.5, "#7C7F86", "pad"));
      parts.push(box(b.x + 0.45, b.y + 0.5, 0.35, 1.0, z * 2.2, color, "tube1"));
      parts.push(box(b.x + 1.15, b.y + 0.5, 0.35, 1.0, z * 2.2, color, "tube2"));
    } else if (b.type === "asw" && b.level > 0) {
      // 대잠 기지: 건물 + 안테나
      parts.push(box(b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, z, color, "body"));
      const t = P(b.x + 0.5, b.y + 0.5);
      parts.push(<Line key="ant" x1={t[0]} y1={t[1] - z} x2={t[0]} y2={t[1] - z - 0.9 * W} stroke="#ddd" strokeWidth={1.5} />);
      parts.push(<Circle key="antTop" cx={t[0]} cy={t[1] - z - 0.9 * W} r={W * 0.08} fill="#FFD166" />);
    } else if (b.type === "radar" && b.level > 0) {
      // 레이더 탑: 받침 + 높은 기둥 + 접시
      parts.push(box(b.x + 0.15, b.y + 0.15, 0.7, 0.7, z, "#7C7F86", "base"));
      parts.push(box(b.x + 0.38, b.y + 0.38, 0.24, 0.24, z + 1.1 * W, color, "mast"));
      const t = P(b.x + 0.5, b.y + 0.5);
      parts.push(<Ellipse key="dish" cx={t[0]} cy={t[1] - z - 1.15 * W} rx={W * 0.42} ry={W * 0.16} fill="#E8ECF4" stroke="#556" strokeWidth={1} />);
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
    if (b.busy_until && b.type !== "dock") {
      // 공사 중: 작업 반장이 건물 앞쪽을 오가며 망치질 (건물과 같은 층이라 앞 건물에 알맞게 가려짐)
      parts.push(
        <Foreman key="wk" from={P(b.x + 0.2, b.y + b.h + 0.25)} to={P(b.x + b.w - 0.1, b.y + b.h + 0.25)} size={W * 0.62} offset={(b.x * 7 + b.y * 3) * 300} />,
      );
    }
    if (sel && b.defense && b.defense.range > 0) {
      // 고른 방어 시설의 사거리 (점선 원)
      const c = P(b.x + b.w / 2, b.y + b.h / 2), r = b.defense.range + Math.max(b.w, b.h) / 2;
      parts.unshift(<Ellipse key="range" cx={c[0]} cy={c[1]} rx={(r * W) / Math.SQRT2} ry={(r * W) / (2 * Math.SQRT2)} fill="#FFD16622" stroke="#FFD166" strokeWidth={1.5} strokeDasharray="6 4" />);
    }
    if (sel) {
      const A = P(b.x, b.y), B = P(b.x + b.w, b.y), C = P(b.x + b.w, b.y + b.h), D = P(b.x, b.y + b.h);
      parts.unshift(<Polygon key="sel" points={pts([A, B, C, D])} fill="#FFFFFF33" stroke="#FFFFFF" strokeWidth={2} />);
    }
    // 이름표는 아래에서 따로 맨 위 층에 그린다 (건물에 가리거나 서로 겹치지 않게)
    const top = P(b.x + b.w / 2, b.y + b.h / 2);
    if (!NO_TAG.has(b.type) || sel || b.busy_until) tagInfo.push({ b, sel, cx: top[0], y: top[1] - (b.type === "dock" ? 0.4 * W : z) - 8 });
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
      {fill}
      {hint}
      {wall}
      {/* 놓기 모드: 건물을 흐리게, 누르기는 아래 땅 칸으로 (건물 그림에 가려진 칸에 잘못 놓이지 않게) */}
      <G opacity={place ? 0.28 : 1} pointerEvents={place ? "none" : "auto"}>
        {items}
      </G>
      {ghost}
      {place ? null : tags}
    </Svg>
  );
}

const CYCLE = 4400;   // 오른쪽으로 걷기 → 망치질 → 왼쪽으로 걷기 → 망치질 (ms)
const WALK = 1600;
const HIT = 600;

/**
 * 작업 반장 (공사 중 표시). 안전모·남색 작업복, 건물 앞을 오가다 끝에서 망치질.
 * 자기 상태만 다시 그려서 지도 전체는 다시 그리지 않는다.
 */
function Foreman({ from, to, size, offset }: { from: Pt; to: Pt; size: number; offset: number }) {
  const [t, setT] = useState(offset % CYCLE);
  useEffect(() => {
    const start = Date.now() - offset;
    const id = setInterval(() => setT((Date.now() - start) % CYCLE), 90);
    return () => clearInterval(id);
  }, [offset]);
  let k: number;          // 0 = 왼쪽 끝, 1 = 오른쪽 끝
  let dir = 1;
  let hitting = false;
  if (t < WALK) k = t / WALK;
  else if (t < WALK + HIT) { k = 1; hitting = true; }
  else if (t < 2 * WALK + HIT) { k = 1 - (t - WALK - HIT) / WALK; dir = -1; }
  else { k = 0; hitting = true; dir = -1; }
  const x = from[0] + (to[0] - from[0]) * k;
  const y = from[1] + (to[1] - from[1]) * k;
  const s = size;
  const walking = !hitting;
  const step = walking ? Math.sin((t / 140) * Math.PI) * s * 0.12 : 0;
  // 망치: 들었다 내리기
  const swing = hitting ? (Math.sin((t / 150) * Math.PI) > 0 ? -1.1 : 0.3) : -0.4;
  const sx = x + dir * s * 0.18, sy = y - s * 0.62;               // 어깨
  const hx = sx + dir * Math.cos(swing) * s * 0.42, hy = sy + Math.sin(swing) * s * 0.42; // 손
  const spark = hitting && swing > 0;
  return (
    <G>
      <Circle cx={x} cy={y + 1} r={s * 0.22} fill="#0003" />
      <Line x1={x - s * 0.06} y1={y - s * 0.3} x2={x - s * 0.08 + step} y2={y} stroke="#1E2A4A" strokeWidth={s * 0.11} strokeLinecap="round" />
      <Line x1={x + s * 0.06} y1={y - s * 0.3} x2={x + s * 0.08 - step} y2={y} stroke="#1E2A4A" strokeWidth={s * 0.11} strokeLinecap="round" />
      <Rect x={x - s * 0.16} y={y - s * 0.72} width={s * 0.32} height={s * 0.45} rx={s * 0.06} fill="#2B3A67" />
      <Rect x={x - s * 0.16} y={y - s * 0.56} width={s * 0.32} height={s * 0.05} fill="#FFD166" />
      <Line x1={sx} y1={sy} x2={hx} y2={hy} stroke="#F2C9A0" strokeWidth={s * 0.08} strokeLinecap="round" />
      <Line x1={hx} y1={hy} x2={hx + dir * Math.cos(swing - 1.57) * s * 0.18} y2={hy + Math.sin(swing - 1.57) * s * 0.18} stroke="#6B4A2B" strokeWidth={s * 0.06} />
      <Rect x={hx + dir * Math.cos(swing - 1.57) * s * 0.18 - s * 0.08} y={hy + Math.sin(swing - 1.57) * s * 0.18 - s * 0.05} width={s * 0.16} height={s * 0.1} fill="#7D7D7D" />
      <Circle cx={x} cy={y - s * 0.84} r={s * 0.14} fill="#F2C9A0" />
      <Polygon points={pts([[x - s * 0.19, y - s * 0.86], [x + s * 0.19, y - s * 0.86], [x + s * 0.13, y - s * 1.02], [x - s * 0.13, y - s * 1.02]])} fill="#FFC21A" stroke="#0003" strokeWidth={0.6} />
      {spark ? (
        <G>
          <Circle cx={hx + dir * s * 0.3} cy={y - s * 0.08} r={s * 0.07} fill="#FFE27A" />
          <Line x1={hx + dir * s * 0.3} y1={y - s * 0.08} x2={hx + dir * s * 0.52} y2={y - s * 0.3} stroke="#FFB020" strokeWidth={1.4} />
          <Line x1={hx + dir * s * 0.3} y1={y - s * 0.08} x2={hx + dir * s * 0.12} y2={y - s * 0.34} stroke="#FFB020" strokeWidth={1.4} />
        </G>
      ) : null}
    </G>
  );
}
