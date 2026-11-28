import {
  Canvas, Circle, DashPathEffect, Fill, Group, Image, Line, LinearGradient, Oval, Path, Rect, RoundedRect,
  useClock, useImage, vec, type SkImage,
} from "@shopify/react-native-skia";
import { useMemo, type ReactNode } from "react";
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

export default function YardCanvasImpl({ cam, width, height, contentW, contentH, map }: YardCanvasProps) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ready]);
  const transform = useDerivedValue(() => [
    { translateX: width / 2 + cam.tx.value }, { translateY: height / 2 + cam.ty.value }, { scale: cam.s.value },
    { translateX: -contentW / 2 }, { translateY: -contentH / 2 },
  ]);
  return (
    <Canvas style={{ position: "absolute", left: 0, top: 0, width, height }} pointerEvents="none">
      <Fill color="#2487CC" />
      <Group transform={transform}>
        <GameMap {...map} kit={kit} layer="art" />
      </Group>
    </Canvas>
  );
}
