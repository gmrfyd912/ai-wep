import { Circle, Group, Oval, RoundedRect } from "@shopify/react-native-skia";
import { useDerivedValue, type SharedValue } from "react-native-reanimated";

/**
 * 조선소 지도의 순간 효과 (Skia, 시계 값으로만 움직임 — 리액트가 다시 그리지 않음).
 * done = 공사 끝(금빛 터짐), collect = 자원 받기(조각이 솟음), dust = 짓기 시작·옮기기(먼지),
 * clear = 폐자재 치움(먼지+반짝), tap = 건물 고름(흰 고리), launch = 진수(물보라+색종이).
 */
export type YardFxKind = "done" | "collect" | "dust" | "clear" | "tap" | "launch";
/** x·y = 지도 칸(가운데), h = 높이(칸 너비 배수), size = 발자국 크기(칸) */
export type YardFxItem = { id: number; kind: YardFxKind; x: number; y: number; h?: number; size?: number };

const DUR: Record<YardFxKind, number> = { done: 1500, collect: 1100, dust: 800, clear: 900, tap: 420, launch: 2200 };

/** 정해진 흩뿌림 (같은 번호는 늘 같은 값 0..1) */
const rnd = (i: number, k: number) => {
  "worklet";
  const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return v - Math.floor(v);
};

type Base = { cx: number; cy: number; W: number; start: number; clock: SharedValue<number> };

/** 0..1 진행 (끝나면 1 에서 멈춤) */
function useT(b: Base, dur: number, delay = 0) {
  const clock = b.clock, start = b.start;
  return useDerivedValue(() => Math.max(0, Math.min(1, (clock.value - start - delay) / dur)));
}

/** 바닥에 퍼지는 고리 (비스듬한 땅이라 납작한 타원) */
function Ring({ b, dur, r0, r1, color, width, delay = 0 }: { b: Base; dur: number; r0: number; r1: number; color: string; width: number; delay?: number }) {
  const t = useT(b, dur, delay);
  const x = useDerivedValue(() => b.cx - (r0 + (r1 - r0) * t.value));
  const y = useDerivedValue(() => b.cy - (r0 + (r1 - r0) * t.value) / 2);
  const w = useDerivedValue(() => (r0 + (r1 - r0) * t.value) * 2);
  const h = useDerivedValue(() => r0 + (r1 - r0) * t.value);
  const o = useDerivedValue(() => (t.value <= 0 || t.value >= 1 ? 0 : 1 - t.value));
  return <Oval x={x} y={y} width={w} height={h} color={color} style="stroke" strokeWidth={width} opacity={o} />;
}

/** 튀어 올랐다 떨어지는 알갱이 하나 */
function Bit({ b, i, dur, speed, up, grav, r, color, square, delay = 0 }: { b: Base; i: number; dur: number; speed: number; up: number; grav: number; r: number; color: string; square?: boolean; delay?: number }) {
  const t = useT(b, dur, delay + rnd(i, 5) * dur * 0.15);
  const a = rnd(i, 1) * Math.PI * 2, sp = speed * (0.5 + rnd(i, 2) * 0.6), u = up * (0.6 + rnd(i, 3) * 0.6);
  const tr = useDerivedValue(() => [
    { translateX: b.cx + Math.cos(a) * sp * t.value },
    { translateY: b.cy + Math.sin(a) * sp * 0.5 * t.value - u * t.value + grav * t.value * t.value },
    { rotate: square ? t.value * (4 + rnd(i, 4) * 6) : 0 },
  ]);
  const o = useDerivedValue(() => (t.value <= 0 || t.value >= 1 ? 0 : Math.min(1, (1 - t.value) * 2.2)));
  return (
    <Group transform={tr} opacity={o}>
      {square ? <RoundedRect x={-r} y={-r * 0.6} width={r * 2} height={r * 1.2} r={r * 0.25} color={color} /> : <Circle cx={0} cy={0} r={r} color={color} />}
    </Group>
  );
}

/** 커지며 옅어지는 먼지 구름 */
function Puff({ b, i, dur, spread, r, color }: { b: Base; i: number; dur: number; spread: number; r: number; color: string }) {
  const t = useT(b, dur, rnd(i, 7) * dur * 0.2);
  const a = rnd(i, 1) * Math.PI * 2, d = spread * (0.4 + rnd(i, 2) * 0.6);
  const cx = useDerivedValue(() => b.cx + Math.cos(a) * d * (0.3 + 0.7 * t.value));
  const cy = useDerivedValue(() => b.cy + Math.sin(a) * d * 0.5 * (0.3 + 0.7 * t.value) - r * 1.5 * t.value);
  const rr = useDerivedValue(() => r * (0.5 + 1.2 * t.value));
  const o = useDerivedValue(() => (t.value <= 0 || t.value >= 1 ? 0 : 0.75 * (1 - t.value)));
  return <Circle cx={cx} cy={cy} r={rr} color={color} opacity={o} />;
}

/** 위로 솟는 빛기둥 */
function Beam({ b, dur, w, h, color }: { b: Base; dur: number; w: number; h: number; color: string }) {
  const t = useT(b, dur);
  const y = useDerivedValue(() => b.cy - h * Math.min(1, t.value * 2.5));
  const hh = useDerivedValue(() => h * Math.min(1, t.value * 2.5));
  const o = useDerivedValue(() => (t.value <= 0 || t.value >= 1 ? 0 : 0.5 * (1 - t.value)));
  return <RoundedRect x={b.cx - w / 2} y={y} width={w} height={hh} r={w / 2} color={color} opacity={o} />;
}

const N = (n: number) => Array.from({ length: n }, (_, i) => i);
const GOLD = ["#FFD23F", "#FFF3C4", "#FFA62B", "#FFFFFF"];
const PARTY = ["#FF5E5B", "#FFD23F", "#3FA7F5", "#4CD08A", "#FFFFFF", "#FF8A1F"];

export function YardFx({ item, P, W, start, clock }: { item: YardFxItem; P: (x: number, y: number) => [number, number]; W: number; start: number; clock: SharedValue<number> }) {
  const g = P(item.x, item.y), size = item.size ?? 2, top = (item.h ?? 0.5) * W;
  const ground: Base = { cx: g[0], cy: g[1], W, start, clock };
  const high: Base = { ...ground, cy: g[1] - top };
  const R = (size * W) / 2;
  const d = DUR[item.kind];
  switch (item.kind) {
    case "done":
      return (
        <Group>
          <Ring b={ground} dur={d * 0.6} r0={R * 0.4} r1={R * 1.7} color="#FFD23F" width={W * 0.12} />
          <Ring b={ground} dur={d * 0.6} r0={R * 0.2} r1={R * 1.3} color="#FFFFFF" width={W * 0.06} delay={140} />
          <Beam b={ground} dur={d * 0.8} w={R * 0.9} h={top + W * 1.6} color="#FFE9A8" />
          {N(16).map((i) => <Bit key={i} b={high} i={i} dur={d} speed={R * 1.8} up={W * 2.2} grav={W * 2.4} r={W * (0.06 + rnd(i, 9) * 0.05)} color={GOLD[i % 4]} />)}
        </Group>
      );
    case "collect":
      return (
        <Group>
          <Ring b={ground} dur={d * 0.5} r0={R * 0.3} r1={R * 1.2} color="#FFFFFF" width={W * 0.05} />
          {N(9).map((i) => <Bit key={i} b={high} i={i} dur={d} speed={R * 0.9} up={W * 2.6} grav={W * 1.2} r={W * 0.1} color={i % 2 ? "#F2A516" : "#B7C6D6"} square />)}
        </Group>
      );
    case "dust":
      return <Group>{N(9).map((i) => <Puff key={i} b={ground} i={i} dur={d} spread={R * 1.3} r={W * 0.28} color="#D9D2C2" />)}</Group>;
    case "clear":
      return (
        <Group>
          {N(6).map((i) => <Puff key={i} b={ground} i={i} dur={d} spread={W * 0.6} r={W * 0.22} color="#D9D2C2" />)}
          {N(6).map((i) => <Bit key={`s${i}`} b={ground} i={i + 20} dur={d} speed={W * 0.7} up={W * 1.3} grav={W * 1.2} r={W * 0.05} color={GOLD[i % 4]} />)}
        </Group>
      );
    case "tap":
      return <Ring b={ground} dur={d} r0={R * 0.6} r1={R * 1.25} color="#FFFFFF" width={W * 0.07} />;
    case "launch":
      return (
        <Group>
          {N(3).map((i) => <Ring key={`r${i}`} b={ground} dur={d * 0.6} r0={R * 0.2} r1={R * 1.6} color="#DDF3FF" width={W * 0.08} delay={i * 260} />)}
          {N(18).map((i) => <Bit key={i} b={ground} i={i} dur={d * 0.6} speed={R * 1.2} up={W * 2.4} grav={W * 3.0} r={W * (0.05 + rnd(i, 9) * 0.06)} color={i % 3 ? "#DDF3FF" : "#FFFFFF"} />)}
          {N(26).map((i) => <Bit key={`c${i}`} b={{ ...ground, cy: g[1] - W * 2.2 }} i={i + 40} dur={d} speed={R * 2.2} up={W * 1.0} grav={W * 3.6} r={W * 0.09} color={PARTY[i % 6]} square delay={200} />)}
        </Group>
      );
  }
}
