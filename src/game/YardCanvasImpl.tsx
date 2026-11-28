import {
  Canvas, Circle, DashPathEffect, Fill, Group, Image, Line, LinearGradient, Oval, Path, Rect, RoundedRect,
  useClock, useImage, vec, type SkImage,
} from "@shopify/react-native-skia";
import { memo, useMemo, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

import { GameMap, origin, type MapKit } from "@/screens/GameMap";

import META from "./yardArt.json";

/**
 * 내 조선소 지도의 새 그림 (Skia 로 그림 — 1초에 60장, Expo Go·웹 모두 됨).
 * - 화면 크기의 그림판 한 장에 지도 전체를 그리고, 끌기·확대는 PanZoom 의 값(cam)을 그대로 받아 그림판 안에서 옮긴다.
 * - 건물 그림은 tools/art/sprites.py 로 미리 뽑아 둔 PNG (assets/yard), 없는 건물은 옛 도형 그대로.
 * - 누르기·이름표는 이 위에 덮은 GameMap(layer="touch") 이 맡는다.
 */
type Pt = [number, number];
type Cam = { tx: SharedValue<number>; ty: SharedValue<number>; s: SharedValue<number> };
type SpriteMeta = { w: number; h: number; pw: number; ph: number; ax: number; ay: number };
const SPRITES = META.sprites as Record<string, SpriteMeta>;
const CELL = META.cellPx;

/* eslint-disable @typescript-eslint/no-explicit-any */
const dash = (d?: string) => (d ? <DashPathEffect intervals={d.split(/[ ,]+/).map(Number)} /> : null);
const polyPath = (points: string) => "M" + points.trim().split(/\s+/).join(" L") + " Z";

function Shape({ fill, stroke, strokeWidth = 1, opacity, fillOpacity, strokeDasharray, strokeLinecap, render }: any) {
  const o = opacity ?? 1;
  return (
    <>
      {fill && fill !== "none" ? render({ color: fill, opacity: o * (fillOpacity ?? 1) }) : null}
      {stroke && stroke !== "none"
        ? render({ color: stroke, opacity: o, style: "stroke", strokeWidth, strokeCap: strokeLinecap, children: dash(strokeDasharray) })
        : null}
    </>
  );
}
const KG = ({ opacity, children }: any) => <Group opacity={opacity ?? 1}>{children}</Group>;
const KPolygon = (p: any) => { const path = polyPath(p.points); return <Shape {...p} render={(q: any) => <Path path={path} {...q} />} />; };
const KLine = ({ x1, y1, x2, y2, stroke, strokeWidth = 1, strokeLinecap, opacity }: any) =>
  <Line p1={vec(x1, y1)} p2={vec(x2, y2)} color={stroke} strokeWidth={strokeWidth} strokeCap={strokeLinecap} opacity={opacity ?? 1} style="stroke" />;
const KCircle = (p: any) => <Shape {...p} render={(q: any) => <Circle cx={p.cx} cy={p.cy} r={p.r} {...q} />} />;
const KEllipse = (p: any) => <Shape {...p} render={(q: any) => <Oval x={p.cx - p.rx} y={p.cy - p.ry} width={p.rx * 2} height={p.ry * 2} {...q} />} />;
const KRect = (p: any) => (
  <Shape {...p} render={(q: any) => (p.rx
    ? <RoundedRect x={p.x} y={p.y} width={p.width} height={p.height} r={p.rx} {...q} />
    : <Rect x={p.x} y={p.y} width={p.width} height={p.height} {...q} />)} />
);
const KText = () => null;   // 글자는 위에 덮은 이름표 층이 그림

/** 조용히 흔들리는 값 0..1 */
function useWave(clock: SharedValue<number>, period: number, phase = 0) {
  return useDerivedValue(() => 0.5 + 0.5 * Math.sin((clock.value / period) * 2 * Math.PI + phase));
}

/** 땅·바다: 풀밭, 콘크리트 바닥(이음 줄), 안벽·계선주, 출렁이는 물결 */
function Ground({ grid, sea, W, clock }: { grid: number; sea: number; W: number; clock: SharedValue<number> }) {
  const { ox, oy } = origin(grid, W);
  const P = (x: number, y: number): Pt => [ox + ((x - y) * W) / 2, oy + ((x + y) * W) / 4];
  const poly = (a: Pt[]) => "M" + a.map((p) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" L") + " Z";
  const M = grid * 2;
  const st = useMemo(() => {
    const land = poly([P(0, 0), P(grid, 0), P(grid, grid), P(0, grid)]);
    const outer = poly([P(-M, -M), P(grid, -M), P(grid, grid + M), P(-M, grid + M)]);
    const seaPath = poly([P(grid, -M), P(grid + M, -M), P(grid + M, grid + M), P(grid, grid + M)]);
    let thin = "", thick = "";
    for (let i = 1; i < grid; i++) {
      const a1 = P(i, 0), a2 = P(i, grid), b1 = P(0, i), b2 = P(grid, i);
      const seg = `M${a1[0].toFixed(1)} ${a1[1].toFixed(1)} L${a2[0].toFixed(1)} ${a2[1].toFixed(1)} M${b1[0].toFixed(1)} ${b1[1].toFixed(1)} L${b2[0].toFixed(1)} ${b2[1].toFixed(1)} `;
      if (i % 4 === 0) thick += seg; else if (i % 2 === 0) thin += seg;
    }
    const road = poly([P(-0.4, -0.4), P(grid, -0.4), P(grid, grid + 0.4), P(-0.4, grid + 0.4)]);
    const fence = poly([P(grid, 0), P(0, 0), P(0, grid), P(grid, grid)]).replace(" Z", "");
    const quay = poly([P(grid - 0.3, 0), P(grid + 0.12, 0), P(grid + 0.12, grid), P(grid - 0.3, grid)]);
    const quaySide = poly([P(grid + 0.12, 0), P(grid + 0.12, grid), [P(grid + 0.12, grid)[0], P(grid + 0.12, grid)[1] + W * 0.14], [P(grid + 0.12, 0)[0], P(grid + 0.12, 0)[1] + W * 0.14]]);
    const foam = `M${P(grid + 0.3, -2).join(" ")} L${P(grid + 0.3, grid + 2).join(" ")}`;
    // 물결: 짧은 가로 줄 (정해진 흩뿌림)
    const waves = ["", ""];
    let r = 7;
    const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 150; k++) {
      const c = P(grid + 0.8 + rnd() * (sea + 9), -5 + rnd() * (grid + 10));
      const len = W * (0.25 + rnd() * 0.45);
      waves[k % 2] += `M${(c[0] - len).toFixed(1)} ${c[1].toFixed(1)} Q${c[0].toFixed(1)} ${(c[1] - W * 0.06).toFixed(1)} ${(c[0] + len).toFixed(1)} ${c[1].toFixed(1)} `;
    }
    const bollards: Pt[] = [];
    for (let y = 1; y < grid; y += 2) bollards.push(P(grid - 0.08, y));
    return { land, outer, seaPath, thin, thick, road, fence, quay, quaySide, foam, waves, bollards };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, sea, W]);
  const w1 = useWave(clock, 3600);
  const w2 = useWave(clock, 4700, 2.1);
  const o1 = useDerivedValue(() => 0.25 + 0.5 * w1.value);
  const o2 = useDerivedValue(() => 0.25 + 0.5 * w2.value);
  const t1 = useDerivedValue(() => [{ translateX: (w1.value - 0.5) * W * 0.5 }, { translateY: (w1.value - 0.5) * W * 0.25 }]);
  const t2 = useDerivedValue(() => [{ translateX: (0.5 - w2.value) * W * 0.4 }, { translateY: (0.5 - w2.value) * W * 0.2 }]);
  const foamO = useDerivedValue(() => 0.35 + 0.4 * w2.value);
  const foamW = useDerivedValue(() => W * (0.1 + 0.08 * w1.value));
  const g0 = P(grid, 0), g1 = P(grid + sea + 10, grid);
  return (
    <Group>
      {/* 바다 */}
      <Path path={st.seaPath}>
        <LinearGradient start={vec(g0[0], g0[1])} end={vec(g1[0], g1[1])} colors={["#3BA3E0", "#2487CC", "#1B6FB4"]} />
      </Path>
      <Group opacity={o1} transform={t1}><Path path={st.waves[0]} color="#BFE6FF" style="stroke" strokeWidth={Math.max(1, W * 0.045)} strokeCap="round" /></Group>
      <Group opacity={o2} transform={t2}><Path path={st.waves[1]} color="#FFFFFF" style="stroke" strokeWidth={Math.max(1, W * 0.035)} strokeCap="round" /></Group>
      {/* 풀밭 + 둘레 길 */}
      <Path path={st.outer} color="#7DB85A" />
      <Path path={st.road} color="#6B727C" />
      {/* 콘크리트 바닥 */}
      <Path path={st.land} color="#CFCABD" />
      <Path path={st.thin} color="#00000012" style="stroke" strokeWidth={Math.max(0.5, W * 0.015)} />
      <Path path={st.thick} color="#0000001F" style="stroke" strokeWidth={Math.max(0.7, W * 0.025)} />
      <Path path={st.fence} color="#F4B81F" style="stroke" strokeWidth={Math.max(1.5, W * 0.06)}>
        <DashPathEffect intervals={[W * 0.3, W * 0.2]} />
      </Path>
      {/* 안벽 + 계선주 + 물가 거품 */}
      <Path path={st.quaySide} color="#6F7780" />
      <Path path={st.quay} color="#A9B0B6" />
      <Path path={st.foam} color="#FFFFFF" style="stroke" strokeWidth={foamW} opacity={foamO} strokeCap="round" />
      {st.bollards.map((b, i) => (
        <Group key={i}>
          <Oval x={b[0] - W * 0.07} y={b[1] - W * 0.03} width={W * 0.14} height={W * 0.07} color="#00000040" />
          <RoundedRect x={b[0] - W * 0.045} y={b[1] - W * 0.13} width={W * 0.09} height={W * 0.12} r={W * 0.02} color="#2E3540" />
        </Group>
      ))}
    </Group>
  );
}

/** 굴뚝 연기: 작은 구름 몇 개가 올라가며 커지고 옅어짐 */
function Puff({ x, y, W, clock, k }: { x: number; y: number; W: number; clock: SharedValue<number>; k: number }) {
  const t = useDerivedValue(() => (clock.value / 4200 + k) % 1);
  const cx = useDerivedValue(() => x + t.value * W * 0.45 + Math.sin(t.value * 6 + k * 9) * W * 0.05);
  const cy = useDerivedValue(() => y - t.value * W * 1.5);
  const r = useDerivedValue(() => W * (0.09 + 0.2 * t.value));
  const o = useDerivedValue(() => Math.min(1, t.value * 8) * (1 - t.value) * 0.85);
  return <Circle cx={cx} cy={cy} r={r} color="#FFFFFF" opacity={o} />;
}
function Smoke({ x, y, W, seed, clock }: { x: number; y: number; W: number; seed: number; clock: SharedValue<number> }) {
  return (
    <Group>
      {[0, 1, 2, 3, 4].map((i) => <Puff key={i} x={x} y={y} W={W} clock={clock} k={i / 5 + (seed % 10) / 10} />)}
    </Group>
  );
}

/**
 * 사람 그림 (발이 0,0). 걷는 다리·망치 든 팔은 시계 값으로 움직여, 리액트가 다시 그리지 않는다.
 * (그림판 안에서 리액트가 다시 그리면 그 순간 끌던 지도가 옛 자리로 한 번 그려져 화면이 떨림)
 */
function Figure({ s, color, step, arm }: { s: number; color: string; step: SharedValue<number>; arm?: { hand: SharedValue<{ x: number; y: number }>; head: SharedValue<{ x: number; y: number }>; from: SharedValue<{ x: number; y: number }>; spark: SharedValue<number> } }) {
  const l1 = useDerivedValue(() => vec(-s * 0.08 + step.value, 0));
  const l2 = useDerivedValue(() => vec(s * 0.08 - step.value, 0));
  return (
    <Group>
      <Circle cx={0} cy={1} r={s * 0.21} color="#00000033" />
      <Line p1={vec(-s * 0.06, -s * 0.3)} p2={l1} color="#1E2A4A" strokeWidth={s * 0.1} strokeCap="round" style="stroke" />
      <Line p1={vec(s * 0.06, -s * 0.3)} p2={l2} color="#1E2A4A" strokeWidth={s * 0.1} strokeCap="round" style="stroke" />
      <RoundedRect x={-s * 0.15} y={-s * 0.7} width={s * 0.3} height={s * 0.42} r={s * 0.06} color={color} />
      {arm ? (
        <>
          <Rect x={-s * 0.15} y={-s * 0.56} width={s * 0.3} height={s * 0.05} color="#FFD166" />
          <Line p1={arm.from} p2={arm.hand} color="#F2C9A0" strokeWidth={s * 0.08} strokeCap="round" style="stroke" />
          <Line p1={arm.hand} p2={arm.head} color="#6B4A2B" strokeWidth={s * 0.06} style="stroke" />
          <Circle c={arm.head} r={s * 0.07} color="#7D7D7D" />
          <Circle c={arm.head} r={s * 0.11} color="#FFD23F" opacity={arm.spark} />
        </>
      ) : null}
      <Circle cx={0} cy={-s * 0.82} r={s * 0.13} color="#F2C9A0" />
      <RoundedRect x={-s * 0.17} y={-s * 0.98} width={s * 0.34} height={s * 0.1} r={s * 0.04} color="#FFC21A" />
    </Group>
  );
}

/** 오가는 대원 (보기용): from → to 걸어갔다 돌아옴 */
function SkWalker({ from, to, size, color, offset, clock }: { from: Pt; to: Pt; size: number; color: string; offset: number; clock: SharedValue<number> }) {
  const LOOP = 9000;
  const tr = useDerivedValue(() => {
    const t = (clock.value + offset) % LOOP, half = LOOP / 2;
    const k = t < half ? t / half : 1 - (t - half) / half;
    return [{ translateX: from[0] + (to[0] - from[0]) * k }, { translateY: from[1] + (to[1] - from[1]) * k }];
  });
  const step = useDerivedValue(() => Math.sin(((clock.value + offset) / 140) * Math.PI) * size * 0.12);
  return <Group transform={tr}><Figure s={size} color={color} step={step} /></Group>;
}

/** 작업 반장 (공사 중 표시): 건물 앞을 오가다 끝에서 망치질 */
function SkForeman({ from, to, size, offset, clock }: { from: Pt; to: Pt; size: number; offset: number; clock: SharedValue<number> }) {
  const CYCLE = 4400, WALK = 1600, HIT = 600, s = size;
  // st = [k(0 왼쪽 끝 ~ 1 오른쪽 끝), 방향, 망치질 중?, 팔 각도]
  const st = useDerivedValue(() => {
    const t = (clock.value + offset) % CYCLE;
    let k = 0, dir = 1, hit = 0;
    if (t < WALK) k = t / WALK;
    else if (t < WALK + HIT) { k = 1; hit = 1; }
    else if (t < 2 * WALK + HIT) { k = 1 - (t - WALK - HIT) / WALK; dir = -1; }
    else { k = 0; hit = 1; dir = -1; }
    const swing = hit ? (Math.sin((t / 150) * Math.PI) > 0 ? -1.1 : 0.3) : -0.4;
    return { k, dir, hit, swing, t };
  });
  const tr = useDerivedValue(() => [{ translateX: from[0] + (to[0] - from[0]) * st.value.k }, { translateY: from[1] + (to[1] - from[1]) * st.value.k }]);
  const step = useDerivedValue(() => (st.value.hit ? 0 : Math.sin((st.value.t / 140) * Math.PI) * s * 0.12));
  const armFrom = useDerivedValue(() => vec(st.value.dir * s * 0.18, -s * 0.62));
  const hand = useDerivedValue(() => vec(st.value.dir * (s * 0.18 + Math.cos(st.value.swing) * s * 0.42), -s * 0.62 + Math.sin(st.value.swing) * s * 0.42));
  const head = useDerivedValue(() => vec(
    st.value.dir * (s * 0.18 + Math.cos(st.value.swing) * s * 0.42 + Math.cos(st.value.swing - 1.57) * s * 0.18),
    -s * 0.62 + Math.sin(st.value.swing) * s * 0.42 + Math.sin(st.value.swing - 1.57) * s * 0.18));
  const spark = useDerivedValue<number>(() => (st.value.hit && st.value.swing > 0 ? 0.9 : 0));
  return <Group transform={tr}><Figure s={s} color="#2B3A67" step={step} arm={{ from: armFrom, hand, head, spark }} /></Group>;
}

/** 지도에 쓰는 그림 파일 (assets/yard) */
function useYardImages(): Record<string, SkImage | null> {
  return {
    hq: useImage(require("../../assets/yard/hq.png")),
    welding: useImage(require("../../assets/yard/welding.png")),
    cutting: useImage(require("../../assets/yard/cutting.png")),
    yard: useImage(require("../../assets/yard/yard.png")),
    dock_base: useImage(require("../../assets/yard/dock_base.png")),
    dock_crane: useImage(require("../../assets/yard/dock_crane.png")),
    tree1: useImage(require("../../assets/yard/tree1.png")),
    tree2: useImage(require("../../assets/yard/tree2.png")),
    cont_x1: useImage(require("../../assets/yard/cont_x1.png")),
    cont_x2: useImage(require("../../assets/yard/cont_x2.png")),
    cont_y1: useImage(require("../../assets/yard/cont_y1.png")),
    cont_y2: useImage(require("../../assets/yard/cont_y2.png")),
  };
}

export type YardCanvasProps = {
  cam: Cam;
  width: number;
  height: number;
  contentW: number;
  contentH: number;
  /** GameMap 에 주는 것과 같은 값 */
  map: Omit<React.ComponentProps<typeof GameMap>, "kit" | "layer">;
};

function YardCanvasImpl({ cam, width, height, contentW, contentH, map }: YardCanvasProps) {
  const images = useYardImages();
  const clock = useClock();
  const ready = Object.values(images).every(Boolean);
  const kit = useMemo<MapKit>(() => ({
    G: KG, Polygon: KPolygon, Line: KLine, Circle: KCircle, Ellipse: KEllipse, Rect: KRect, SvgText: KText,
    sprite: (name, x, y, P, W, key): ReactNode => {
      const m = SPRITES[name], img = images[name];
      if (!m || !img) return null;
      const k = W / CELL, p = P(x, y);
      return <Image key={key} image={img} x={p[0] - m.ax * k} y={p[1] - m.ay * k} width={m.pw * k} height={m.ph * k} fit="fill" />;
    },
    Ground: (p: any) => <Ground {...p} clock={clock} />,
    Smoke: (p: any) => <Smoke {...p} clock={clock} />,
    Walker: (p: any) => <SkWalker {...p} clock={clock} />,
    Foreman: (p: any) => <SkForeman {...p} clock={clock} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ready]);
  const transform = useDerivedValue(() => [
    { translateX: width / 2 + cam.tx.value }, { translateY: height / 2 + cam.ty.value }, { scale: cam.s.value },
    { translateX: -contentW / 2 }, { translateY: -contentH / 2 },
  ]);
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill color="#2487CC" />
      <Group transform={transform}>
        <GameMap {...map} kit={kit} layer="art" />
      </Group>
    </Canvas>
  );
}

/** 지도에 보이는 것이 바뀌었나 (남은 시간·누르기 함수처럼 그림과 상관없는 값은 빼고 비교) */
function sig(m: YardCanvasProps["map"]) {
  return JSON.stringify([m.grid, m.sea, m.W, m.selected, m.reclaiming, m.place, m.ship, m.fleet, m.crews, m.scraps,
    m.buildings.map((b) => [b.id, b.type, b.level, b.x, b.y, b.w, b.h, !!b.busy_until, b.room, b.defense?.range])]);
}

/**
 * 그림이 바뀔 때만 다시 그림. 게임 화면은 남은 시간 때문에 1초마다 다시 그려지는데,
 * 그때마다 그림판까지 다시 그리면 끌던 지도가 한 번씩 떨린다.
 */
export default memo(YardCanvasImpl, (a, b) =>
  a.cam.tx === b.cam.tx && a.width === b.width && a.height === b.height && a.contentW === b.contentW && a.contentH === b.contentH && sig(a.map) === sig(b.map));
