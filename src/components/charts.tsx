import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from "react-native-svg";

import { colors } from "@/theme";

export type Pt = [number, number];

export type Series = { points: Pt[]; color: string; dots?: boolean };
export type HLine = { y: number; color: string; dashed?: boolean; label?: string };
export type Band = { x0: number; x1: number; color: string };
export type YBand = { y0: number; y1: number; color: string };
export type Marker = { x: number; y: number; color: string; r?: number };

const PAD = { l: 40, r: 20, t: 10, b: 26 };

function niceStep(range: number, count: number) {
  const raw = range / Math.max(count, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

function ticks(lo: number, hi: number, count: number) {
  const step = niceStep(hi - lo, count);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

const fmt = (v: number) => (Math.abs(v) >= 10 || Number.isInteger(v) ? String(Math.round(v * 10) / 10) : v.toFixed(1));

/** 간단한 선 그래프 (확대·스크롤 없음). x축 눈금 글자는 xLabel 함수로 바꿀 수 있다. */
export function LineChart({
  series,
  height = 200,
  hlines = [],
  bands = [],
  ybands = [],
  markers = [],
  yMin,
  yMax,
  yPad = 0.15,
  xTickCount = 5,
  xLabel = fmt,
  xTicksAt,
  caption,
}: {
  series: Series[];
  height?: number;
  hlines?: HLine[];
  bands?: Band[];
  ybands?: YBand[];
  markers?: Marker[];
  yMin?: number;
  yMax?: number;
  yPad?: number;
  xTickCount?: number;
  xLabel?: (x: number) => string;
  /** 지정하면 이 x 위치에만 눈금 (예: 회차 번호) */
  xTicksAt?: number[];
  caption?: string;
}) {
  const [w, setW] = useState(0);
  const all = series.flatMap((s) => s.points);
  if (!all.length) return null;
  const xs = all.map((p) => p[0]);
  const ys = [...all.map((p) => p[1]), ...hlines.map((h) => h.y)];
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  if (x1 === x0) {
    x0 -= 1;
    x1 += 1;
  }
  let y0 = yMin ?? Math.min(...ys);
  let y1 = yMax ?? Math.max(...ys);
  const span = y1 - y0 || Math.max(Math.abs(y1), 1);
  if (yMin == null) y0 -= span * yPad;
  if (yMax == null) y1 += span * yPad;

  const iw = Math.max(w - PAD.l - PAD.r, 1);
  const ih = height - PAD.t - PAD.b;
  const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0)) * iw;
  const sy = (y: number) => PAD.t + (1 - (y - y0) / (y1 - y0)) * ih;
  const clampY = (y: number) => Math.min(Math.max(y, y0), y1);

  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          {ybands.map((b, i) => (
            <Rect key={`yb${i}`} x={PAD.l} width={iw} y={sy(clampY(b.y1))}
              height={Math.max(sy(clampY(b.y0)) - sy(clampY(b.y1)), 0)} fill={b.color} />
          ))}
          {bands.map((b, i) => (
            <Rect key={`b${i}`} x={sx(Math.max(b.x0, x0))} y={PAD.t}
              width={Math.max(sx(Math.min(b.x1, x1)) - sx(Math.max(b.x0, x0)), 0)} height={ih} fill={b.color} />
          ))}
          {ticks(y0, y1, 4).map((v) => (
            <G key={`y${v}`} y={sy(v)} label={fmt(v)} x={PAD.l} x2={PAD.l + iw} />
          ))}
          {(xTicksAt ?? ticks(x0, x1, xTickCount)).map((v) => (
            <SvgText key={`x${v}`} x={sx(v)} y={height - 8} fontSize={10} fill={colors.muted} textAnchor="middle">
              {xLabel(v)}
            </SvgText>
          ))}
          {hlines.map((h, i) => (
            <Line key={`h${i}`} x1={PAD.l} x2={PAD.l + iw} y1={sy(h.y)} y2={sy(h.y)} stroke={h.color}
              strokeWidth={1.5} strokeDasharray={h.dashed ? "5,4" : undefined} />
          ))}
          {hlines.filter((h) => h.label).map((h, i) => (
            <SvgText key={`hl${i}`} x={PAD.l + iw - 2} y={sy(h.y) - 4} fontSize={10} fill={h.color} textAnchor="end">
              {h.label}
            </SvgText>
          ))}
          {series.map((s, i) => (
            <Path key={`s${i}`} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round"
              d={s.points.map((p, j) => `${j ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(" ")} />
          ))}
          {series.filter((s) => s.dots).flatMap((s, i) =>
            s.points.map((p, j) => <Circle key={`d${i}-${j}`} cx={sx(p[0])} cy={sy(p[1])} r={3} fill={s.color} />),
          )}
          {markers.map((m, i) => (
            <Circle key={`m${i}`} cx={sx(m.x)} cy={sy(m.y)} r={m.r ?? 5} fill={m.color} stroke="#000" strokeWidth={1} />
          ))}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

/** 가로 눈금선 + 왼쪽 숫자 */
function G({ y, label, x, x2 }: { y: number; label: string; x: number; x2: number }) {
  return (
    <>
      <Line x1={x} x2={x2} y1={y} y2={y} stroke={colors.border} strokeWidth={1} />
      <SvgText x={x - 4} y={y + 3} fontSize={10} fill={colors.muted} textAnchor="end">
        {label}
      </SvgText>
    </>
  );
}

/** 가로 막대 (결함 통계용) */
export function BarList({ items }: { items: { label: string; value: number; color: string }[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <View style={{ gap: 8 }}>
      {items.map((it) => (
        <View key={it.label} style={styles.barRow}>
          <Text style={styles.barLabel} numberOfLines={1}>{it.label}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.bar, { width: `${(it.value / max) * 100}%`, backgroundColor: it.color }]} />
          </View>
          <Text style={styles.barValue}>{it.value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  caption: { color: colors.faint, fontSize: 11, textAlign: "center", marginTop: 2 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  barLabel: { color: colors.muted, fontSize: 13, width: 80 },
  barTrack: { flex: 1, height: 14, backgroundColor: colors.cardAlt, borderRadius: 7, overflow: "hidden" },
  bar: { height: 14, borderRadius: 7 },
  barValue: { color: colors.text, fontSize: 13, fontWeight: "700", width: 28, textAlign: "right" },
});
