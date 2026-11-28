import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import Svg, { Circle as SvgCircle, Ellipse as SvgEllipse, G as SvgG, Line as SvgLine, Polygon as SvgPolygon, Rect as SvgRect, Text as SvgText0 } from "react-native-svg";

import ART_META from "@/game/yardArt.json";
import type { GameBuilding, GameScrap, GameShipKind, GameWarKind } from "@/lib/api";

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
  rally: "#D9C9A3",
};
/** 집결장에 서 있는 대원 색 (종류별) */
const CREW_COLOR: Record<string, string> = {
  welder: "#2B3A67", fitter: "#2E9D5B", piper: "#8A6A47", safety: "#F2C230",
  forklift: "#F2A516", transporter: "#5B8BB5", crane: "#E0A526",
};
const MACHINES = new Set(["forklift", "transporter", "crane"]);
/** 방어 시설 (지도에 이름표 대신 레벨만 작게: 장벽·기뢰는 많아서 이름표 생략) */
const NO_TAG = new Set(["wall", "mine"]);
/** 전투함 회색 (상선은 빨간 배) */
export const WAR_COLOR = "#6F7C8A";
export const RES_COLOR = { steel: "#8FA3B8", rods: "#F2A516", tech: "#57C4E5", passes: "#E05A9B", fame: "#FFD166" };
/** 건물 높이 (칸 너비 배수): 뒤 건물을 덜 가리게 낮게 (2026-11-28 화면 개편) */
const BASE_H: Record<string, number> = {
  hq: 0.8, yard: 0.3, rodstore: 0.4, cutting: 0.5, welding: 0.55, academy: 0.6, dock: 0, pier: 0.2,
  battery: 0.3, missile: 0.25, mine: 0, asw: 0.4, radar: 0.25, wall: 0.35,
  trainhall: 0.55, dorm: 0.6, garage: 0.45, rally: 0,
};

type Pt = [number, number];

/* eslint-disable @typescript-eslint/no-explicit-any */
type Prim = ComponentType<any>;
/**
 * 그리기 도구 묶음. 같은 지도 코드를 react-native-svg(옛 방식)로도, Skia(새 그림)로도 그리게 함.
 * Sprite·Ground·Smoke 는 새 그림에서만 있음.
 */
export type MapKit = {
  G: Prim; Polygon: Prim; Line: Prim; Circle: Prim; Ellipse: Prim; Rect: Prim; SvgText: Prim;
  /** 미리 그려 둔 건물 그림 (이름, 기준 칸 x·y) → 없으면 null */
  sprite?: (name: string, x: number, y: number, P: (x: number, y: number) => Pt, W: number, key: string, scale?: number) => ReactNode | null;
  /** 물 위에서 출렁이는 묶음 (seed 로 박자를 다르게) */
  Bob?: Prim;
  /** 길(칸 목록)을 따라 오가는 지게차 */
  Mover?: Prim;
  /** 깜빡이는 용접 불빛 */
  Spark?: Prim;
  Ground?: Prim;
  Smoke?: Prim;
  /** 오가는 대원·작업 반장 (없으면 아래 Walker·Foreman) */
  Walker?: Prim;
  Foreman?: Prim;
};
export const svgKit: MapKit = { G: SvgG, Polygon: SvgPolygon, Line: SvgLine, Circle: SvgCircle, Ellipse: SvgEllipse, Rect: SvgRect, SvgText: SvgText0 };
/** 건물의 새 그림 이름: 레벨에 따라 겉모습 3단계 (1~3 / 4~6 / 7~8), 짓는 중이면 비계 */
export function artName(b: { type: string; level: number; w: number; h: number }) {
  if (b.type === "dock") return null;
  if (b.level <= 0) return `site_${b.w}x${b.h}`;
  const t = b.type === "pier" ? (b.level >= 3 ? 2 : 1) : b.type === "mine" || b.type === "rally" ? 1 : b.level <= 3 ? 1 : b.level <= 6 ? 2 : 3;
  return `${b.type}_${t}`;
}
const ART = (ART_META as { sprites: Record<string, { z?: number }> }).sprites;
/** 새 그림의 높이 (칸 너비 배수, 누르는 범위·이름표 자리에 씀). 그림이 없으면 0 */
const artH = (name: string | null) => (name && ART[name]?.z ? ART[name].z! * 0.5 : 0);

function shade(hex: string, k: number) {
  const m = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(hex);   // 이미 한 번 밝기를 바꾼 색도 받음
  const n = m ? (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]) : parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

const pts = (a: Pt[]) => a.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

/** 땅 바깥 꾸밈 땅(컨테이너·나무) 칸 수: 지도를 끌면 땅 가장자리 너머도 보이게 */
const MARGIN = 3;
/** 지도 그림 원점: P(x, y) = [ox + (x − y)·W/2, oy + (x + y)·W/4] */
export function origin(grid: number, W: number) {
  return { ox: (grid / 2 + MARGIN) * W, oy: (MARGIN / 2 + 2) * W };
}

/** 지도 크기: 칸 너비 W 에서 전체 너비·높이 (땅 + 해안 바다 + 둘레 꾸밈 땅) */
export function mapSize(grid: number, W: number, sea = 2) {
  const { oy } = origin(grid, W);
  return { width: (grid + sea / 2 + 2 * MARGIN) * W, height: oy + ((2 * grid + sea + 2 * MARGIN) * W) / 4 + 0.5 * W };
}

/** 빈 칸을 따라 가는 가장 짧은 길 (칸 목록). 없으면 null */
function cellPath(from: [number, number], to: [number, number], grid: number, blocked: Set<string>): [number, number][] | null {
  const key = (x: number, y: number) => `${x},${y}`;
  const ok = (x: number, y: number) => x >= 0 && y >= 0 && x < grid && y < grid && !blocked.has(key(x, y));
  if (!ok(from[0], from[1]) || !ok(to[0], to[1])) return null;
  const prev = new Map<string, [number, number] | null>([[key(from[0], from[1]), null]]);
  const q: [number, number][] = [from];
  for (let h = 0; h < q.length; h++) {
    const [x, y] = q[h];
    if (x === to[0] && y === to[1]) {
      const out: [number, number][] = [];
      let c: [number, number] | null = [x, y];
      while (c) { out.unshift(c); c = prev.get(key(c[0], c[1])) ?? null; }
      return out;
    }
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (ok(nx, ny) && !prev.has(key(nx, ny))) { prev.set(key(nx, ny), [x, y]); q.push([nx, ny]); }
    }
  }
  return null;
}

/** 건물 가운데가 지도 그림에서 어디인지 (화면을 그 건물로 옮길 때) */
export function centerOf(b: { x: number; y: number; w: number; h: number }, grid: number, W: number) {
  const { ox, oy } = origin(grid, W);
  const x = b.x + b.w / 2, y = b.y + b.h / 2;
  return { x: ox + ((x - y) * W) / 2, y: oy + ((x + y) * W) / 4 };
}

/** 놓을 건물 크기·조건 */
export type PlaceRule = { w: number; h: number; coast?: boolean; sea?: boolean; skipId?: string };

/** 폐자재를 자리 검사용 1칸짜리 가짜 건물로 (서버 scrap_blocks 와 같음) */
export function scrapBlocks(scraps: GameScrap[] | undefined): GameBuilding[] {
  return (scraps ?? []).map((p) => ({ id: `scrap:${p.id}`, type: "scrap" as GameBuilding["type"], level: 1, x: p.x, y: p.y, w: 1, h: 1,
    fixed: true, busy_until: null, pending: 0, just_done: false, block: null }) as unknown as GameBuilding);
}

/** 그 칸(x, y)에 놓을 수 있나 (서버 _free 와 같은 규칙: 겹침·해안·바다·배 물길) */
export function canPlace(buildings: GameBuilding[], r: PlaceRule, grid: number, sea: number, x: number, y: number) {
  if (y < 0 || x < 0 || y + r.h > grid) return false;
  const used = new Set<string>();
  const berth = new Set<string>();
  for (const b of buildings) {
    if (b.id === r.skipId) continue;
    for (let i = 0; i < b.w; i++) for (let j = 0; j < b.h; j++) used.add(`${b.x + i},${b.y + j}`);
    if (b.type === "dock") for (let j = 0; j < b.h; j++) berth.add(`${grid},${b.y + j}`);
    if (b.type === "pier") for (let i = 0; i < 2; i++) for (let j = 0; j < b.h; j++) berth.add(`${grid + i},${b.y + j}`);
  }
  if (r.sea) {
    if (x < grid || x + r.w > grid + sea) return false;
    for (let i = 0; i < r.w; i++) for (let j = 0; j < r.h; j++) {
      const k = `${x + i},${y + j}`;
      if (used.has(k) || berth.has(k)) return false;
    }
    return true;
  }
  if (x + r.w > grid) return false;
  if (r.coast && x + r.w !== grid) return false;
  for (let i = 0; i < r.w; i++) for (let j = 0; j < r.h; j++) if (used.has(`${x + i},${y + j}`)) return false;
  return true;
}

/** 처음 놓을 자리: 놓을 수 있는 칸 중 본관(없으면 가운데)에 가장 가까운 곳 */
export function autoSpot(buildings: GameBuilding[], r: PlaceRule, grid: number, sea: number) {
  const hq = buildings.find((b) => b.type === "hq");
  const cx = hq ? hq.x + hq.w / 2 : grid / 2, cy = hq ? hq.y + hq.h / 2 : grid / 2;
  let best: { x: number; y: number; d: number } | null = null;
  for (let y = 0; y < grid; y++)
    for (let x = 0; x < grid + sea; x++) {
      if (!canPlace(buildings, r, grid, sea, x, y)) continue;
      const d = (x + r.w / 2 - cx) ** 2 + (y + r.h / 2 - cy) ** 2;
      if (!best || d < best.d) best = { x, y, d };
    }
  return best ? { x: best.x, y: best.y } : null;
}

/** 지도 그림 안의 점(px, py) → 칸 좌표 (소수). GameMap 의 비스듬한 그리기를 거꾸로 */
export function cellAt(px: number, py: number, grid: number, W: number) {
  const { ox, oy } = origin(grid, W);
  const a = (px - ox) / (W / 2);
  const b = (py - oy) / (W / 4);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

/** 칸 영역 (x, y, w, h)이 지도 그림에서 차지하는 네모 (건물 높이 z 만큼 위로) */
export function cellBox(x: number, y: number, w: number, h: number, grid: number, W: number, z = 0.6 * W) {
  const { ox, oy } = origin(grid, W);
  const P = (cx: number, cy: number) => [ox + ((cx - cy) * W) / 2, oy + ((cx + cy) * W) / 4];
  const c = [P(x, y), P(x + w, y), P(x + w, y + h), P(x, y + h)];
  return { x1: Math.min(...c.map((p) => p[0])), x2: Math.max(...c.map((p) => p[0])), y1: Math.min(...c.map((p) => p[1])) - z, y2: Math.max(...c.map((p) => p[1])) };
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
  onCollect,
  names = true,
  crews,
  scraps = [],
  onScrap,
  now,
  kit = svgKit,
  layer = "all",
}: {
  /** 그리기 도구 (기본 = react-native-svg) */
  kit?: MapKit;
  /** all = 옛 방식(그림+누르기 한 번에), art = 그림만(Skia 안), touch = 누르는 곳과 이름표만(그림 위에 덮음) */
  layer?: "all" | "art" | "touch";
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
  /** 건물 위 '받기' 동그라미를 눌렀을 때 (생산분 받기) */
  onCollect?: () => void;
  /** 땅 위 폐자재 (누르면 치우기) */
  scraps?: GameScrap[];
  onScrap?: (id: string) => void;
  /** 집결장에 보일 대원 (종류별 수) */
  crews?: Partial<Record<string, number>>;
  /** 모든 건물 이름표 보이기 (끄면 고른 건물·공사 중 시간·받기 동그라미만) */
  names?: boolean;
  /** 화면 글자: 남은 시간 등 */
  now: { left: (b: GameBuilding) => string | null; done: string };
}) {
  const { G, Polygon, Line, Circle, Ellipse, Rect, SvgText } = kit;
  const WalkerC = kit.Walker ?? Walker, ForemanC = kit.Foreman ?? Foreman;
  const spr = (name: string, x: number, y: number, key: string, scale = 1) => (kit.sprite ? kit.sprite(name, x, y, P, W, key, scale) : null);
  const H = W / 2;
  const WATER_COLS = sea;
  const { width, height } = mapSize(grid, W, sea);
  const { ox, oy } = origin(grid, W);
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

  /** 레벨이 오르면 층 줄·창문이 늘어남 (앞 두 면에) */
  const floors = (x: number, y: number, w: number, h: number, z: number, lv: number) => {
    const out: React.ReactNode[] = [];
    const n = Math.min(1 + Math.floor(lv / 2), 4);   // 층 수: 1·2·2·3·3·4…
    const D = P(x, y + h), C = P(x + w, y + h), B = P(x + w, y);
    const L = (a: Pt, b2: Pt, t: number, up: number): Pt => [a[0] + (b2[0] - a[0]) * t, a[1] + (b2[1] - a[1]) * t - up];
    const fh = z / n;
    for (let k = 0; k < n; k++) {
      const h0 = k * fh + fh * 0.3, h1 = k * fh + fh * 0.75;
      if (k > 0) out.push(<Polygon key={`fl${k}`} points={pts([L(D, C, 0, k * fh), L(D, C, 1, k * fh), L(C, B, 1, k * fh)])} fill="none" stroke="#0002" strokeWidth={0.8} />);
      // 창문: 앞면(D→C) w칸마다 2개, 옆면(C→B) h칸마다 1개
      const nw = Math.max(1, Math.round(w * 1.5)), nh = Math.max(1, Math.round(h));
      for (let i = 0; i < nw; i++) {
        const t0 = (i + 0.25) / nw, t1 = (i + 0.7) / nw;
        out.push(<Polygon key={`wf${k}-${i}`} points={pts([L(D, C, t0, h0), L(D, C, t1, h0), L(D, C, t1, h1), L(D, C, t0, h1)])} fill="#DDEBF5" opacity={0.85} />);
      }
      for (let i = 0; i < nh; i++) {
        const t0 = (i + 0.3) / nh, t1 = (i + 0.7) / nh;
        out.push(<Polygon key={`ws${k}-${i}`} points={pts([L(C, B, t0, h0), L(C, B, t1, h0), L(C, B, t1, h1), L(C, B, t0, h1)])} fill="#B9CCDA" opacity={0.8} />);
      }
    }
    return out;
  };

  const blocked = useMemo(() => [...buildings, ...scrapBlocks(scraps)], [buildings, scraps]);
  const fits = (x: number, y: number) => !!place && canPlace(blocked, place, grid, WATER_COLS, x, y);

  // 바깥 땅·바다·조선소 땅: 큰 판 몇 장 + 칸 줄 (칸마다 그리지 않아 가벼움)
  const M = grid * 2;   // 화면 끝까지 덮게 넉넉히
  const ground: React.ReactNode[] = [];
  /** 누르는 곳 (touch 층에서만 씀): 거의 안 보이는 도형 */
  const hits: React.ReactNode[] = [];
  const HIT = { fill: "#fff", fillOpacity: 0.01 } as const;
  if (kit.Ground) {
    ground.push(<kit.Ground key="ground" grid={grid} sea={sea} W={W} />);
  } else {
    ground.push(
      <Polygon key="outer" points={pts([P(-M, -M), P(grid, -M), P(grid, grid + M), P(-M, grid + M)])} fill="#7E9A5C" onPress={() => !place && onSelect(null)} />,
      <Polygon key="land" points={pts([P(0, 0), P(grid, 0), P(grid, grid), P(0, grid)])} fill="#C8C2B4" onPress={() => !place && onSelect(null)} />,
    );
    // 칸 줄 (2칸마다 진하게)
    for (let i = 0; i <= grid; i++) {
      const a1 = P(i, 0), a2 = P(i, grid), b1 = P(0, i), b2 = P(grid, i);
      const sw = i % 2 ? 0.4 : 0.8;
      ground.push(<Line key={`gx${i}`} x1={a1[0]} y1={a1[1]} x2={a2[0]} y2={a2[1]} stroke="#00000018" strokeWidth={sw} />);
      ground.push(<Line key={`gy${i}`} x1={b1[0]} y1={b1[1]} x2={b2[0]} y2={b2[1]} stroke="#00000018" strokeWidth={sw} />);
    }
    // 바다 쪽 물결
    for (let k = 0; k < grid; k += 3) {
      const c = P(grid + 1.2 + (k % 2), k + 0.5);
      ground.push(<Line key={`wv${k}`} x1={c[0] - W * 0.35} y1={c[1]} x2={c[0] + W * 0.35} y2={c[1]} stroke="#7FC0EE" strokeWidth={1.2} opacity={0.7} />);
    }
  }
  // 놓기 모드: 놓을 수 있는 칸만 초록 (누르면 그 자리)
  if (place)
    for (let x = 0; x < grid + WATER_COLS; x++)
      for (let y = 0; y < grid; y++) {
        if (!fits(x, y)) continue;
        const corners = [P(x, y), P(x + 1, y), P(x + 1, y + 1), P(x, y + 1)];
        ground.push(
          <Polygon key={`t${x}-${y}`} points={pts(corners)} fill={(x + y) % 2 ? "#7FD18F" : "#73C985"} stroke="#00000014" strokeWidth={0.5} onPress={() => onPlace(x, y)} />,
        );
        if (layer === "touch") hits.push(<SvgPolygon key={`ht${x}-${y}`} points={pts(corners)} {...HIT} onPress={() => onPlace(x, y)} />);
      }
  // 조선소 울타리 (바다 쪽 빼고 세 면) + 해안 안벽
  const fence = [P(grid, 0), P(0, 0), P(0, grid), P(grid, grid)];
  if (!kit.Ground) {
    ground.push(<Polygon key="fence" points={pts(fence)} fill="none" stroke="#E8B400" strokeWidth={2} strokeDasharray="8 5" />);
    ground.push(<Polygon key="quay" points={pts([P(grid, 0), P(grid + 0.15, 0), P(grid + 0.15, grid), P(grid, grid)])} fill="#9AA3AB" />);
  }

  // 둘레 꾸밈: 컨테이너 더미·나무 (지을 수 없는 바깥 땅)
  const deco: React.ReactNode[] = [];
  const CONT = ["#B33B2E", "#2B7FBF", "#2E9D5B", "#E0A526"];
  if (kit.sprite) {
    // 새 그림: 컨테이너 더미·나무 (뒤에서 앞으로)
    for (let k = 0; k < grid; k += 2) {
      if (k % 6 === 2) deco.push(spr(k % 4 ? "tree1" : "tree2", k + 0.5, -4.4, `tt${k}`));
      deco.push(spr((k / 2) % 2 ? "cont_y1" : "cont_y2", k, -2.6, `ct${k}`));
    }
    for (let k = 0; k < grid; k += 2) {
      if (k % 6 === 0) deco.push(spr(k % 4 ? "tree2" : "tree1", -4.4, k + 0.5, `tl${k}`));
      deco.push(spr((k / 2) % 2 ? "cont_x1" : "cont_x2", -2.6, k, `cl${k}`));
    }
    for (let k = 0; k < grid - 2; k += 3) deco.push(spr(k % 6 === 0 ? "tree1" : k % 2 ? "cont_x2" : "cont_x1", k, grid + 0.9, `cb${k}`));
  } else {
  for (let k = 0; k < grid; k += 2) {
    deco.push(box(-2.2, k + 0.2, 1.6, 0.8, (0.35 + ((k / 2) % 3) * 0.3) * W, CONT[(k / 2) % 4], `cl${k}`));
    if (k % 6 === 0) deco.push(<Circle key={`tl${k}`} cx={P(-3.8, k + 1)[0]} cy={P(-3.8, k + 1)[1] - W * 0.5} r={W * 0.45} fill="#4E7A3A" />);
  }
  for (let k = 0; k < grid; k += 2) {
    deco.push(box(k + 0.2, -2.2, 0.8, 1.6, (0.35 + ((k / 2 + 1) % 3) * 0.3) * W, CONT[(k / 2 + 1) % 4], `ct${k}`));
    if (k % 6 === 2) deco.push(<Circle key={`tt${k}`} cx={P(k + 1, -3.8)[0]} cy={P(k + 1, -3.8)[1] - W * 0.5} r={W * 0.45} fill="#4E7A3A" />);
  }
  for (let k = 0; k < grid - 2; k += 3) {
    if (k % 6 === 0) deco.push(<Circle key={`tb${k}`} cx={P(k + 1, grid + 1.6)[0]} cy={P(k + 1, grid + 1.6)[1] - W * 0.5} r={W * 0.45} fill="#4E7A3A" />);
    else deco.push(box(k + 0.2, grid + 0.8, 1.6, 0.8, 0.5 * W, CONT[k % 4], `cb${k}`));
  }

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
    fill.push(<ForemanC kit={kit} key="rf" from={P(grid + 0.3, grid + 1.4)} to={P(1, grid + 1.4)} size={W * 0.62} offset={777} />);
  }

  const wall: React.ReactNode[] = [];

  // 집결장마다 서 있을 대원: 자리(room)만큼 차례로 나눔 (사람 1·장비 2자리)
  const rallyCrew: Record<string, string[]> = {};
  {
    const rallies = buildings.filter((b) => b.type === "rally" && b.level > 0);
    const queue: string[] = [];
    Object.entries(crews ?? {}).forEach(([k, n]) => {
      for (let i = 0; i < (n ?? 0); i++) queue.push(k);
    });
    // 사람·장비가 골고루 섞이게 종류를 번갈아
    queue.sort((a, b) => Number(MACHINES.has(a)) - Number(MACHINES.has(b)));
    // 집결장이 여러 개면 돌아가며 하나씩 (새로 지은 집결장에도 대원이 보이게)
    const used = rallies.map(() => 0);
    rallies.forEach((r) => (rallyCrew[r.id] = []));
    let turn = 0;
    for (const k of queue) {
      const need = MACHINES.has(k) ? 2 : 1;
      for (let j = 0; j < rallies.length; j++) {
        const i = (turn + j) % rallies.length;
        if (used[i] + need <= (rallies[i].room ?? 8)) {
          used[i] += need;
          rallyCrew[rallies[i].id].push(k);
          turn = i + 1;
          break;
        }
      }
    }
  }
  const walkers: React.ReactNode[] = [];
  const smokes: React.ReactNode[] = [];

  const tagInfo: { b: GameBuilding; sel: boolean; cx: number; y: number }[] = [];
  const sorted = [...buildings].sort((a, b) => a.x + a.w + a.y + a.h - (b.x + b.w + b.y + b.h));
  const items = sorted.map((b) => {
    const color = BUILDING_COLOR[b.type] ?? "#999";
    const sel = selected === b.id;
    const lv = Math.max(b.level, 1);
    const an = kit.sprite || layer === "touch" ? artName(b) : null;
    const z = artH(an) ? artH(an) * W : (BASE_H[b.type] + lv * 0.06) * W;
    const art = an ? spr(an, b.x, b.y, "art") : null;
    const parts: React.ReactNode[] = [];
    if (b.type === "dock") {
      // 도크: 물 + 크레인 기둥 + 배
      const A = P(b.x, b.y), B = P(b.x + b.w, b.y), C = P(b.x + b.w, b.y + b.h), D = P(b.x, b.y + b.h);
      const base = spr("dock_base", b.x, b.y, "pool");
      parts.push(base ?? <Polygon key="pool" points={pts([A, B, C, D])} fill="#1F6FA8" stroke="#555" strokeWidth={2} />);
      const hullC = ship?.war ? WAR_COLOR : "#B33B2E";
      const shipArt = ship ? spr(ship.stage >= 4 ? `ship_${ship.kind}` : `ship_${ship.war ? "w" : "c"}${Math.max(0, ship.stage)}`, b.x, b.y, "ship") : null;
      if (shipArt) parts.push(shipArt);
      else if (ship) {
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
      const crane = spr("dock_crane", b.x, b.y, "crane");
      parts.push(crane ??
        <G key="crane">
          <Rect x={c1[0] - 2} y={c1[1] - ch} width={4} height={ch} fill="#F2C230" />
          <Rect x={c2[0] - 2} y={c2[1] - ch} width={4} height={ch} fill="#F2C230" />
          <Polygon points={pts([[c1[0], c1[1] - ch], [c2[0], c2[1] - ch], [c2[0], c2[1] - ch - 6], [c1[0], c1[1] - ch - 6]])} fill="#F2C230" stroke="#0004" />
        </G>,
      );
    } else if (art && b.type !== "pier" && b.type !== "rally") {
      // 새 그림 (미리 그려 둔 건물)
      parts.push(art);
      if (kit.Smoke && b.level > 0 && (b.type === "welding" || b.type === "cutting")) {
        const c = P(b.x + 0.45, b.y + 0.45), tier = b.level <= 3 ? 1 : b.level <= 6 ? 2 : 3;
        if (kit.Spark && b.type === "welding") {
          const sp = P(b.x + 1.0, b.y + 2.0);
          smokes.push(<kit.Spark key={`sp${b.id}`} x={sp[0]} y={sp[1] - 0.075 * W} W={W} seed={b.x * 3 + b.y} />);
        }
        smokes.push(<kit.Smoke key={`sm${b.id}`} x={c[0]} y={c[1] - (1.7 + 0.12 * tier) * 0.612 * W} W={W} seed={b.x * 7 + b.y * 13} />);
      }
    } else if (b.type === "pier" && b.level > 0) {
      // 군항 부두: 낮은 잔교 + 계류 기둥, 옆 바다에 전투함이 나란히 정박
      if (art) parts.push(art);
      else {
        parts.push(box(b.x + 0.1, b.y + 0.05, b.w - 0.1, b.h - 0.1, 0.22 * W, color, "deck"));
        for (let k = 0; k < b.h; k++) parts.push(box(b.x + b.w - 0.3, b.y + k + 0.4, 0.15, 0.15, 0.45 * W, "#333", `bol${k}`));
      }
      fleet.slice(0, 6).forEach((kind, i) => {
        const col = Math.floor(i / b.h), row = i % b.h;
        const sx = b.x + b.w + 0.1 + col * 1.05, sy = b.y + row + 0.2;
        const len = kind === "landing" ? 1.0 : kind === "frigate" ? 0.95 : 0.75;
        // 새 그림: 2칸 길이로 부두에 나란히 (둘째 줄은 그 바깥)
        const warArt = spr(`war_${kind}`, b.x + b.w + 0.1 + col * 2.05, b.y + row, `wa${i}`);
        if (warArt) {
          parts.push(kit.Bob ? <kit.Bob key={`wb${i}`} seed={i * 1.7 + b.y} amp={W * 0.035}>{warArt}</kit.Bob> : warArt);
          return;
        }
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
    } else if (b.type === "rally" && b.level > 0) {
      // 집결장: 넓은 광장 + 깃발 + 모여 선 대원·장비 (박사 요청 2026-11-28)
      const A = P(b.x + 0.1, b.y + 0.1), B = P(b.x + b.w - 0.1, b.y + 0.1), C = P(b.x + b.w - 0.1, b.y + b.h - 0.1), D = P(b.x + 0.1, b.y + b.h - 0.1);
      const f = P(b.x + 0.35, b.y + 0.35);
      if (art) parts.push(art);
      else {
        parts.push(<Polygon key="plaza" points={pts([A, B, C, D])} fill="#E6DCC4" stroke="#B8955A" strokeWidth={1.5} />);
        parts.push(<Line key="fpole" x1={f[0]} y1={f[1]} x2={f[0]} y2={f[1] - 1.1 * W} stroke="#555" strokeWidth={1.5} />);
        parts.push(<Polygon key="flag" points={pts([[f[0], f[1] - 1.1 * W], [f[0] + 0.45 * W, f[1] - 0.95 * W], [f[0], f[1] - 0.8 * W]])} fill="#FF8A1F" />);
      }
      const list = rallyCrew[b.id] ?? [];
      // 앞줄(화면 아래쪽)부터 채움: 뒤쪽은 옆 건물·이름표에 가려질 수 있어서
      const cols = 4, gap = (b.w - 0.6) / cols;
      const cells: [number, number][] = [];
      for (let r = 0; r < cols; r++) for (let q = 0; q < cols; q++) cells.push([b.x + 0.55 + q * gap, b.y + 0.55 + r * gap]);
      cells.sort((a, c) => c[0] + c[1] - (a[0] + a[1]) || a[0] - c[0]);
      const shown = list.slice(0, 16).map((k, i) => ({ k, i, gx: cells[i][0], gy: cells[i][1] }));
      shown.sort((a, c) => a.gx + a.gy - (c.gx + c.gy));   // 뒤에서 앞으로 그려야 겹침이 자연스러움
      shown.forEach(({ k, i, gx, gy }) => {
        const c = P(gx, gy);
        const col = CREW_COLOR[k] ?? "#333";
        const crewArt = spr(`crew_${k}`, gx - 0.5, gy - 0.5, `ca${i}`, MACHINES.has(k) ? 1 : 1.2);
        if (crewArt) parts.push(crewArt);
        else if (MACHINES.has(k)) {
          parts.push(box(gx - 0.25, gy - 0.18, k === "transporter" ? 0.65 : 0.45, 0.36, (k === "crane" ? 0.6 : 0.28) * W, col, `m${i}`));
        } else {
          const u = W * 1.4;   // 사람 크기
          parts.push(<Rect key={`pb${i}`} x={c[0] - u * 0.07} y={c[1] - u * 0.28} width={u * 0.14} height={u * 0.22} rx={u * 0.03} fill={col} />);
          parts.push(<Circle key={`ph${i}`} cx={c[0]} cy={c[1] - u * 0.34} r={u * 0.07} fill="#F2C9A0" />);
          parts.push(<Rect key={`hh${i}`} x={c[0] - u * 0.08} y={c[1] - u * 0.43} width={u * 0.16} height={u * 0.05} rx={u * 0.02} fill="#FFC21A" />);
        }
      });
      if (list.length > 16) {
        const c = P(b.x + b.w - 0.4, b.y + b.h - 0.3);
        parts.push(<SvgText key="more" x={c[0]} y={c[1]} fontSize={W * 0.32} fill="#5A4A2A" textAnchor="middle" fontWeight="bold">{`+${list.length - 16}`}</SvgText>);
      }
      // 대원 둘이 집결장과 가까운 건물 사이를 오감 (보기용)
      if (list.length && !place && walkers.length < 3) {
        const near = buildings.filter((o) => o.id !== b.id && o.type !== "wall" && o.type !== "mine" && o.x < grid)
          .sort((p1, p2) => Math.abs(p1.x - b.x) + Math.abs(p1.y - b.y) - (Math.abs(p2.x - b.x) + Math.abs(p2.y - b.y)))[0];
        if (near) {
          walkers.push(<WalkerC kit={kit} key={`wk${b.id}`} from={P(b.x + b.w / 2, b.y + b.h + 0.2)} to={P(near.x + near.w / 2, near.y + near.h + 0.2)} size={W * 0.55}
            color={CREW_COLOR[list[0]] ?? "#2B3A67"} offset={b.x * 131 + b.y * 17} />);
        }
      }
    } else if (b.level === 0) {
      // 새로 짓는 중: 비계(뼈대)
      parts.push(box(b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, 0.12 * W, "#9B8F7A", "base"));
      const A = P(b.x + 0.2, b.y + b.h - 0.2), C = P(b.x + b.w - 0.2, b.y + b.h - 0.2);
      parts.push(<Line key="sc1" x1={A[0]} y1={A[1]} x2={A[0]} y2={A[1] - 0.8 * W} stroke="#F2C230" strokeWidth={2} />);
      parts.push(<Line key="sc2" x1={C[0]} y1={C[1]} x2={C[0]} y2={C[1] - 0.8 * W} stroke="#F2C230" strokeWidth={2} />);
      parts.push(<Line key="sc3" x1={A[0]} y1={A[1] - 0.8 * W} x2={C[0]} y2={C[1] - 0.8 * W} stroke="#F2C230" strokeWidth={2} />);
    } else {
      parts.push(box(b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, z, color, "body"));
      parts.push(...floors(b.x + 0.1, b.y + 0.1, b.w - 0.2, b.h - 0.2, z, lv));
      if (lv >= 4 && b.type !== "hq") parts.push(box(b.x + 0.35, b.y + 0.35, 0.5, 0.45, z + 0.22 * W, shade(color, 0.85), "roof1"));
      if (lv >= 7 && b.type !== "hq") parts.push(box(b.x + b.w - 0.8, b.y + b.h - 0.75, 0.4, 0.4, z + 0.3 * W, "#B9C2CC", "roof2"));
      if (b.type === "hq") {
        const t = P(b.x + b.w / 2, b.y + b.h / 2);
        parts.push(<Line key="pole" x1={t[0]} y1={t[1] - z} x2={t[0]} y2={t[1] - z - 0.9 * W} stroke="#eee" strokeWidth={1.5} />);
        parts.push(<Rect key="flag" x={t[0]} y={t[1] - z - 0.9 * W} width={0.45 * W} height={0.28 * W} fill="#FF8A1F" />);
      }
      if (b.type === "cutting" || b.type === "welding") parts.push(box(b.x + b.w - 0.6, b.y + 0.3, 0.3, 0.3, z + 0.6 * W, "#6B6B6B", "chim"));
    }
    if (b.busy_until && b.level > 0 && b.type !== "dock" && b.type !== "wall" && b.type !== "mine") {
      // 레벨 올리는 중: 건물 둘레에 노란 비계 (앞쪽 기둥 세 개 + 가로대)
      const sh = z + 0.25 * W;
      const cs = [P(b.x + 0.05, b.y + b.h - 0.05), P(b.x + b.w - 0.05, b.y + b.h - 0.05), P(b.x + b.w - 0.05, b.y + 0.05)];
      cs.forEach((c, i) => parts.push(<Line key={`sp${i}`} x1={c[0]} y1={c[1]} x2={c[0]} y2={c[1] - sh} stroke="#F2C230" strokeWidth={1.6} />));
      [0.35, 0.7, 1].forEach((t, i) =>
        parts.push(<Polygon key={`sb${i}`} points={pts(cs.map((c) => [c[0], c[1] - sh * t] as Pt))} fill="none" stroke="#E0A800" strokeWidth={1.2} />));
    }
    if (b.busy_until && b.type !== "dock") {
      // 공사 중: 작업 반장이 건물 앞쪽을 오가며 망치질 (건물과 같은 층이라 앞 건물에 알맞게 가려짐)
      parts.push(
        <ForemanC kit={kit} key="wk" from={P(b.x + 0.2, b.y + b.h + 0.25)} to={P(b.x + b.w - 0.1, b.y + b.h + 0.25)} size={W * 0.62} offset={(b.x * 7 + b.y * 3) * 300} />,
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
    const coinOn = b.pending > 0 && !b.busy_until;
    if ((names && !NO_TAG.has(b.type)) || sel || b.busy_until || b.just_done || coinOn)
      tagInfo.push(b.type === "rally"
        // 집결장 이름표는 깃발 위에 (광장 가운데에 서 있는 대원을 가리지 않게)
        ? { b, sel, cx: P(b.x + 0.35, b.y + 0.35)[0], y: P(b.x + 0.35, b.y + 0.35)[1] - 1.2 * W - 4 }
        : { b, sel, cx: top[0], y: top[1] - (b.type === "dock" ? 0.4 * W : z) - 8 });
    if (layer === "touch" && !place) {
      // 누르는 범위: 건물 상자의 겉 테두리 (바닥 + 높이)
      const A = P(b.x, b.y), B = P(b.x + b.w, b.y), C = P(b.x + b.w, b.y + b.h), D = P(b.x, b.y + b.h);
      const zz = Math.max(z, 0.25 * W);
      const up = (p: Pt): Pt => [p[0], p[1] - zz];
      hits.push(<SvgPolygon key={`hb${b.id}`} points={pts([D, C, B, up(B), up(A), up(D)])} {...HIT} onPress={() => onSelect(b.id)} />);
      return null;
    }
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
      const showName = (names && !NO_TAG.has(b.type)) || sel;
      const tw = showName ? label.length * fs * 0.95 + 10 : 0;
      const left = now.left(b);
      const chip = left ?? (b.just_done ? now.done : null);
      const cw = chip ? chip.length * fs * 0.75 + 12 : 0;
      const coin = !chip && b.pending > 0;
      const cr = fs * 1.25;   // 받기 동그라미 반지름
      const half = Math.max(tw, cw, coin ? cr * 2 : 0) / 2 + 2;
      const blockH = (chip ? 2 * fs + 12 : fs + 6) + (coin ? cr * 2 + 4 : 0) + 2;
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
          {showName ? (
            <G>
              <Rect x={cx - tw / 2} y={tagY - fs - 2} width={tw} height={fs + 6} rx={(fs + 6) / 2} fill={sel ? "#FF8A1F" : "#0B2033D9"} />
              <SvgText x={cx} y={tagY + 1} fontSize={fs} fill="#fff" textAnchor="middle">
                {label}
              </SvgText>
            </G>
          ) : null}
          {chip && (
            <G>
              <Rect x={cx - cw / 2} y={tagY - (showName ? 2 * fs + 8 : fs + 2)} width={cw} height={fs + 6} rx={(fs + 6) / 2} fill={left ? "#0B2033" : "#2E9D5B"} />
              <SvgText x={cx} y={tagY - (showName ? fs + 5 : -1)} fontSize={fs} fill={left ? "#FFD166" : "#fff"} textAnchor="middle">
                {chip}
              </SvgText>
              {left && b.busy_until && b.total ? (() => {
                // 공사 진행 막대 (채워진 만큼 끝나 감)
                const rest = Math.max(0, (Date.parse(b.busy_until) - Date.now()) / 1000);
                const f = Math.min(1, Math.max(0.03, 1 - rest / b.total));
                const by = tagY - (showName ? fs + 8 : -fs + 2) + fs + 7;
                return (
                  <G>
                    <Rect x={cx - cw / 2 + 3} y={by} width={cw - 6} height={4} rx={2} fill="#0B2033" />
                    <Rect x={cx - cw / 2 + 3} y={by} width={(cw - 6) * f} height={4} rx={2} fill="#4CD07D" />
                  </G>
                );
              })() : null}
            </G>
          )}
          {coin && (
            // 받기 동그라미: 누르면 바로 생산분 받기
            <G onPress={place ? undefined : () => (onCollect ? onCollect() : onSelect(b.id))}>
              <Circle cx={cx} cy={tagY - (showName ? fs + 4 : 0) - cr} r={cr} fill="#FFFFFF" stroke="#0B2033" strokeWidth={2} />
              <Rect x={cx - cr * 0.45} y={tagY - (showName ? fs + 4 : 0) - cr * 1.45} width={cr * 0.9} height={cr * 0.9} rx={2}
                fill={b.type === "cutting" ? RES_COLOR.steel : RES_COLOR.rods} />
            </G>
          )}
        </G>
      );
    });

  // 폐자재: 쇠파이프 더미·철판 조각·드럼통 (누르면 치우기)
  const scrapItems = scraps.map((p) => {
    const c = P(p.x + 0.5, p.y + 0.5);
    const k: React.ReactNode[] = [];
    const scrapArt = spr(`scrap_${p.kind === "pipe" || p.kind === "plate" ? p.kind : "drum"}`, p.x, p.y, "sa");
    if (scrapArt) k.push(scrapArt);
    else if (p.kind === "pipe") {
      [0, 1, 2].forEach((i) => {
        const a = P(p.x + 0.2, p.y + 0.3 + i * 0.18), e = P(p.x + 0.85, p.y + 0.3 + i * 0.18);
        k.push(<Line key={i} x1={a[0]} y1={a[1] - (i === 1 ? 3 : 0)} x2={e[0]} y2={e[1] - (i === 1 ? 3 : 0)} stroke="#6E747B" strokeWidth={W * 0.11} strokeLinecap="round" />);
      });
    } else if (p.kind === "plate") {
      k.push(box(p.x + 0.15, p.y + 0.2, 0.7, 0.55, 0.08 * W, "#8C7A66", "p1"));
      k.push(box(p.x + 0.3, p.y + 0.3, 0.5, 0.4, 0.16 * W, "#A0522D", "p2"));
    } else {
      k.push(<Ellipse key="d1" cx={c[0] - W * 0.12} cy={c[1] - W * 0.18} rx={W * 0.13} ry={W * 0.2} fill="#C0392B" stroke="#5A1A12" strokeWidth={0.8} />);
      k.push(<Ellipse key="d2" cx={c[0] + W * 0.14} cy={c[1] - W * 0.12} rx={W * 0.13} ry={W * 0.2} fill="#2E6DA4" stroke="#123" strokeWidth={0.8} />);
    }
    if (layer === "touch" && !place && onScrap)
      hits.push(<SvgEllipse key={`hs${p.id}`} cx={c[0]} cy={c[1] - W * 0.1} rx={W * 0.5} ry={W * 0.34} {...HIT} onPress={() => onScrap(p.id)} />);
    return (
      <G key={`scrap-${p.id}`} onPress={place || !onScrap ? undefined : () => onScrap(p.id)}>
        {scrapArt ? null : <Ellipse cx={c[0]} cy={c[1]} rx={W * 0.48} ry={W * 0.24} fill="#5B4A3355" />}
        {k}
      </G>
    );
  });

  // 지게차: 강판 야드에서 가까운 공장 문 앞까지 빈 땅을 따라 오감 (보기용, 건물보다 먼저 그려 앞 건물에 가려짐)
  let mover: React.ReactNode = null;
  if (kit.Mover && !place) {
    const yardB = buildings.find((o) => o.type === "yard" && o.level > 0);
    const shops = buildings.filter((o) => (o.type === "cutting" || o.type === "welding") && o.level > 0);
    if (yardB && shops.length) {
      const shop = [...shops].sort((a, c) => Math.abs(a.x - yardB.x) + Math.abs(a.y - yardB.y) - (Math.abs(c.x - yardB.x) + Math.abs(c.y - yardB.y)))[0];
      const blocked = new Set<string>();
      buildings.forEach((o) => { for (let i = 0; i < o.w; i++) for (let j = 0; j < o.h; j++) blocked.add(`${o.x + i},${o.y + j}`); });
      scraps.forEach((o) => blocked.add(`${o.x},${o.y}`));
      const path = cellPath([yardB.x, yardB.y + yardB.h], [shop.x, shop.y + shop.h], grid, blocked);
      if (path && path.length > 2) mover = <kit.Mover key={`mv${path.length}-${path[0]}-${path[path.length - 1]}`} path={path} P={P} W={W} />;
    }
  }

  // 놓기 모드: 고른 자리(또는 추천 자리) 미리보기
  let ghost: React.ReactNode = null;
  const g = place?.pick ?? null;
  if (place && g) ghost = <G opacity={0.75}>{box(g.x + 0.1, g.y + 0.1, place.w - 0.2, place.h - 0.2, 0.6 * W, place.color, "ghost")}</G>;
  let hint: React.ReactNode = null;
  if (place?.hint && !g) {
    const A = P(place.hint.x, place.hint.y), B = P(place.hint.x + place.w, place.hint.y);
    const C = P(place.hint.x + place.w, place.hint.y + place.h), D = P(place.hint.x, place.hint.y + place.h);
    hint = <Polygon points={pts([A, B, C, D])} fill="#FFE27A" stroke="#fff" strokeWidth={2.5} strokeDasharray="5 4" onPress={() => onPlace(place.hint!.x, place.hint!.y)} />;
    if (layer === "touch") hits.push(<SvgPolygon key="hhint" points={pts([A, B, C, D])} {...HIT} onPress={() => onPlace(place.hint!.x, place.hint!.y)} />);
  }

  if (layer === "art")
    return (
      <G>
        {ground}
        {deco}
        {fill}
        {hint}
        {wall}
        <G opacity={place ? 0.28 : 1}>
          {scrapItems}
          {mover}
          {items}
          {walkers}
          {smokes}
        </G>
        {ghost}
      </G>
    );
  if (layer === "touch")
    return (
      <Svg width={width} height={height}>
        <SvgRect x={0} y={0} width={width} height={height} {...HIT} onPress={() => !place && onSelect(null)} />
        {hits}
        {place ? null : tags}
      </Svg>
    );
  return (
    <Svg width={width} height={height}>
      <Rect x={0} y={0} width={width} height={height} fill="#2B7FBF" onPress={() => !place && onSelect(null)} />
      {ground}
      {deco}
      {fill}
      {hint}
      {wall}
      {/* 놓기 모드: 건물을 흐리게, 누르기는 아래 땅 칸으로 (건물 그림에 가려진 칸에 잘못 놓이지 않게) */}
      <G opacity={place ? 0.28 : 1} pointerEvents={place ? "none" : "auto"}>
        {scrapItems}
        {items}
        {walkers}
      </G>
      {ghost}
      {place ? null : tags}
    </Svg>
  );
}

/** 오가는 대원 (보기용): from → to 걸어갔다 돌아옴 */
function Walker({ kit, from, to, size, color, offset }: { kit: MapKit; from: Pt; to: Pt; size: number; color: string; offset: number }) {
  const { G, Line, Circle, Rect } = kit;
  const LOOP = 9000;
  const [t, setT] = useState(offset % LOOP);
  useEffect(() => {
    const start = Date.now() - offset;
    const id = setInterval(() => setT((Date.now() - start) % LOOP), 120);
    return () => clearInterval(id);
  }, [offset]);
  const half = LOOP / 2;
  const k = t < half ? t / half : 1 - (t - half) / half;
  const x = from[0] + (to[0] - from[0]) * k, y = from[1] + (to[1] - from[1]) * k;
  const s = size, step = Math.sin((t / 140) * Math.PI) * s * 0.12;
  return (
    <G pointerEvents="none">
      <Circle cx={x} cy={y + 1} r={s * 0.2} fill="#0003" />
      <Line x1={x - s * 0.06} y1={y - s * 0.3} x2={x - s * 0.08 + step} y2={y} stroke="#1E2A4A" strokeWidth={s * 0.1} strokeLinecap="round" />
      <Line x1={x + s * 0.06} y1={y - s * 0.3} x2={x + s * 0.08 - step} y2={y} stroke="#1E2A4A" strokeWidth={s * 0.1} strokeLinecap="round" />
      <Rect x={x - s * 0.15} y={y - s * 0.7} width={s * 0.3} height={s * 0.42} rx={s * 0.06} fill={color} />
      <Circle cx={x} cy={y - s * 0.82} r={s * 0.13} fill="#F2C9A0" />
      <Rect x={x - s * 0.17} y={y - s * 0.98} width={s * 0.34} height={s * 0.1} rx={s * 0.04} fill="#FFC21A" />
    </G>
  );
}

const CYCLE = 4400;   // 오른쪽으로 걷기 → 망치질 → 왼쪽으로 걷기 → 망치질 (ms)
const WALK = 1600;
const HIT = 600;

/**
 * 작업 반장 (공사 중 표시). 안전모·남색 작업복, 건물 앞을 오가다 끝에서 망치질.
 * 자기 상태만 다시 그려서 지도 전체는 다시 그리지 않는다.
 */
function Foreman({ kit, from, to, size, offset }: { kit: MapKit; from: Pt; to: Pt; size: number; offset: number }) {
  const { G, Line, Circle, Rect, Polygon } = kit;
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
