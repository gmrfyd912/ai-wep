import { Image } from "expo-image";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Line } from "react-native-svg";
import { useTranslation } from "react-i18next";

import { LineChart, PAD, type VLine } from "@/components/charts";
import { ZoomImage } from "@/components/ZoomImage";
import { Card, Chips } from "@/components/ui";
import type { CheckLayout, EngineResult } from "@/lib/api";
import { defectName } from "@/lib/defects";
import {
  SIGNAL_COLORS,
  SIGNAL_RULES,
  defectSignal,
  straightSignal,
  widthSignal,
  type Signal,
} from "@/lib/signals";
import { colors, space } from "@/theme";

type Tab = "width" | "straight" | "signal";

// 확인 그림과 같은 색
const C = { width: "#3CDC3C", mean: "#FF8A1F", min: "#FF0000", max: "#FF00FF", center: "#FFE600", base: "#0078FF", dev: "#FFFFFF" };
const GRAY = "rgba(120,120,120,0.25)";

/** 결과 화면 위쪽: ① 폭 변화 ② 직진도 ③ 신호등 (기본 ①).
 * 새 결과(check_layout 있음)는 그래프 바로 밑에 같은 폭·같은 방향의 확인 그림을 붙인다. */
export function ResultCharts({ result, checkUrl }: { result: EngineResult; checkUrl?: string | null }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("width");
  const bead = result.bead;
  if (!bead) return null;
  const layout = checkUrl ? result.check_layout ?? null : null;
  const xr = layout ? { xMin: layout.x_start_mm, xMax: layout.x_end_mm } : {};
  const sign = layout?.dev_sign ?? 1;
  const devProfile = bead.straightness.profile?.map((p) => [p[0], p[1] * sign] as [number, number]);
  const guides: VLine[] = [
    ...(bead.width.min_pos_mm != null ? [{ x: bead.width.min_pos_mm, color: C.min }] : []),
    ...(bead.width.max_pos_mm != null ? [{ x: bead.width.max_pos_mm, color: C.max }] : []),
    ...(bead.straightness.max_dev_pos_mm != null ? [{ x: bead.straightness.max_dev_pos_mm, color: C.dev }] : []),
  ];
  const vl = layout ? { vlines: guides } : {};
  const L = bead.length_mm;
  const trim = bead.width.end_trim_mm ?? 10;
  const pipe = !!bead.pipe;
  // 검사 구간 밖은 회색 (평판 = 양 끝 10mm, 배관 = 꼭대기 양쪽 45° 밖)
  const z0 = bead.width.zone_start_mm ?? trim;
  const z1 = bead.width.zone_end_mm ?? L - trim;
  const ends =
    z1 - z0 < L - 0.5 && z1 > z0
      ? [
          ...(z0 > 0 ? [{ x0: 0, x1: z0, color: GRAY }] : []),
          ...(z1 < L ? [{ x0: z1, x1: L, color: GRAY }] : []),
        ]
      : [];
  const mmLabel = (x: number) => String(Math.round(x));

  return (
    <Card>
      <Chips<Tab>
        options={[
          { value: "width", label: t("chart_tabWidth") },
          { value: "straight", label: t("chart_tabStraight") },
          { value: "signal", label: t("chart_tabSignal") },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "width" ? (
        bead.width.profile?.length ? (
          <>
            <Text style={styles.axis}>{t("chart_widthY")}</Text>
            <LineChart
              {...xr}
              {...vl}
              series={[{ points: bead.width.profile, color: C.width }]}
              bands={ends}
              hlines={[{ y: bead.width.mean_mm, color: C.mean, dashed: true, label: `${t("chart_mean")} ${bead.width.mean_mm.toFixed(1)}` }]}
              markers={[
                ...(bead.width.min_pos_mm != null ? [{ x: bead.width.min_pos_mm, y: bead.width.min_mm, color: C.min }] : []),
                ...(bead.width.max_pos_mm != null ? [{ x: bead.width.max_pos_mm, y: bead.width.max_mm, color: C.max }] : []),
              ]}
              xLabel={mmLabel}
              caption={t("chart_xDist")}
            />
            <Legend
              items={[
                [C.width, t("legend_actualWidth"), "line"],
                [C.mean, t("result_widthMean"), "dash"],
                [C.min, t("result_widthMin")],
                [C.max, t("result_widthMax")],
                ...(layout && bead.straightness.max_dev_pos_mm != null ? ([[C.dev, t("legend_maxDevPos"), "vdash"]] as LegendItem[]) : []),
                [GRAY, t(pipe ? "legend_excludedPipe" : "legend_excluded"), "box"],
              ]}
            />
          </>
        ) : (
          <Text style={styles.empty}>{t("chart_noData")}</Text>
        )
      ) : tab === "straight" ? (
        bead.straightness.profile?.length ? (
          <>
            <Text style={styles.axis}>{t("chart_devY")}</Text>
            <LineChart
              {...xr}
              {...vl}
              series={[{ points: devProfile!, color: C.center }]}
              bands={ends}
              ybands={[{ y0: -SIGNAL_RULES.straight.green, y1: SIGNAL_RULES.straight.green, color: "rgba(34,197,94,0.10)" }]}
              hlines={[{ y: 0, color: C.base }]}
              markers={(() => {
                const p = bead.straightness.max_dev_pos_mm;
                if (p == null) return [];
                const hit = devProfile!.reduce((a, b) => (Math.abs(b[0] - p) < Math.abs(a[0] - p) ? b : a));
                return [{ x: hit[0], y: hit[1], color: C.dev }];
              })()}
              yMin={Math.min(-1.5, ...devProfile!.map((q) => q[1] * 1.15))}
              yMax={Math.max(1.5, ...devProfile!.map((q) => q[1] * 1.15))}
              xLabel={mmLabel}
              caption={t("chart_xDist")}
            />
            <Legend
              items={[
                [C.center, t("legend_center"), "line"],
                [C.base, t(pipe ? "legend_baselineCurve" : "legend_baseline"), "line"],
                [C.dev, t("legend_maxDev")],
                ...(layout
                  ? ([
                      ...(bead.width.min_pos_mm != null ? [[C.min, t("legend_minPos"), "vdash"]] : []),
                      ...(bead.width.max_pos_mm != null ? [[C.max, t("legend_maxPos"), "vdash"]] : []),
                    ] as LegendItem[])
                  : []),
                ["rgba(34,197,94,0.35)", t("chart_greenZone", { mm: SIGNAL_RULES.straight.green }), "box"],
                [GRAY, t(pipe ? "legend_excludedPipe" : "legend_excluded"), "box"],
              ]}
            />
          </>
        ) : (
          <Text style={styles.empty}>{t("chart_noStraightData")}</Text>
        )
      ) : (
        <SignalPanel result={result} />
      )}
      {layout && checkUrl && tab !== "signal" ? <AlignedImage uri={checkUrl} layout={layout} guides={guides} /> : null}
    </Card>
  );
}

/** 그래프와 같은 가로 범위로 맞춘 확인 그림. 그래프 그림 영역(PAD.l ~ 오른쪽 PAD.r)과 정확히 겹친다 */
function AlignedImage({ uri, layout, guides }: { uri: string; layout: CheckLayout; guides: VLine[] }) {
  const { t } = useTranslation();
  const [w, setW] = useState(0);
  const [zoom, setZoom] = useState(false);
  const h = w > 0 ? (w * layout.height) / layout.width : 0;
  const span = layout.x_end_mm - layout.x_start_mm;
  return (
    <View>
      <Text style={styles.axis}>{t("chart_alignedImage")}</Text>
      <Pressable
        onPress={() => setZoom(true)}
        style={{ marginLeft: PAD.l, marginRight: PAD.r }}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
      >
        {w > 0 ? (
          <View style={{ width: w, height: h }}>
            <Image source={{ uri }} style={{ width: w, height: h }} contentFit="fill" />
            <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
              {guides.map((g, i) => {
                const x = ((g.x - layout.x_start_mm) / span) * w;
                return <Line key={i} x1={x} x2={x} y1={0} y2={h} stroke={g.color} strokeWidth={1} strokeDasharray="3,3" />;
              })}
            </Svg>
          </View>
        ) : null}
      </Pressable>
      <Text style={styles.zoomHint}>{t("result_tapToZoom")}</Text>
      <ZoomImage uri={uri} visible={zoom} onClose={() => setZoom(false)} />
    </View>
  );
}

function SignalPanel({ result }: { result: EngineResult }) {
  const { t } = useTranslation();
  const b = result.bead!;
  const defects = result.defects ?? [];
  const range = b.width.max_mm - b.width.min_mm;
  const R = SIGNAL_RULES;
  return (
    <View style={{ gap: space.md }}>
      <SignalRow
        signal={widthSignal(b.width.min_mm, b.width.max_mm)}
        title={t("signal_width")}
        value={`${range.toFixed(1)} mm`}
        rule={t("signal_widthRule", { g: R.widthRange.green, y: R.widthRange.yellow })}
      />
      <SignalRow
        signal={straightSignal(b.straightness.max_dev_mm)}
        title={t("signal_straight")}
        value={`${b.straightness.max_dev_mm.toFixed(1)} mm`}
        rule={t("signal_straightRule", { g: R.straight.green, y: R.straight.yellow })}
      />
      <SignalRow
        signal={defectSignal(defects.map((d) => d.type))}
        title={t("signal_defects")}
        value={t("signal_count", { count: defects.length })}
        detail={defects.length ? defects.map((d) => defectName(d.type)).join(", ") : undefined}
        rule={t("signal_defectRule")}
      />
      <Text style={styles.note}>{t("signal_note")}</Text>
    </View>
  );
}

export function SignalDot({ signal, size = 14 }: { signal: Signal | null; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: signal ? SIGNAL_COLORS[signal] : colors.faint,
      }}
    />
  );
}

function SignalRow({ signal, title, value, rule, detail }: { signal: Signal | null; title: string; value: string; rule: string; detail?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.sigRow}>
      <SignalDot signal={signal} size={28} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.sigHead}>
          <Text style={styles.sigTitle}>{title}</Text>
          <Text style={[styles.sigValue, signal && { color: SIGNAL_COLORS[signal] }]}>
            {value}
            {signal ? `  ${t(`signal_${signal}`)}` : ""}
          </Text>
        </View>
        {detail ? <Text style={styles.sigDetail}>{detail}</Text> : null}
        <Text style={styles.sigRule}>{rule}</Text>
      </View>
    </View>
  );
}

/** 범례 한 줄: [색, 이름, 모양]. 모양: dot 점(기본) · line 실선 · dash 가로 점선 · vdash 세로 점선 · box 배경 */
type LegendItem = [string, string, ("dot" | "line" | "dash" | "vdash" | "box")?];

function Swatch({ color, kind = "dot" }: { color: string; kind?: LegendItem[2] }) {
  if (kind === "line") return <View style={{ width: 16, height: 3, borderRadius: 2, backgroundColor: color }} />;
  if (kind === "dash")
    return (
      <View style={{ flexDirection: "row", gap: 2 }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ width: 4, height: 2, backgroundColor: color }} />
        ))}
      </View>
    );
  if (kind === "vdash")
    return (
      <View style={{ gap: 2, width: 10, alignItems: "center" }}>
        {[0, 1, 2].map((i) => (
          <View key={i} style={{ width: 2, height: 3, backgroundColor: color }} />
        ))}
      </View>
    );
  if (kind === "box") return <View style={{ width: 14, height: 10, borderRadius: 2, backgroundColor: color }} />;
  return <View style={[styles.swatch, { backgroundColor: color }]} />;
}

function Legend({ items }: { items: LegendItem[] }) {
  return (
    <View style={styles.legend}>
      {items.map(([c, label, kind]) => (
        <View key={label} style={styles.legendItem}>
          <Swatch color={c} kind={kind} />
          <Text style={styles.legendText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { color: colors.muted, fontSize: 11 },
  zoomHint: { color: colors.faint, fontSize: 11, textAlign: "center", marginTop: 4 },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 20, paddingVertical: space.lg, textAlign: "center" },
  note: { color: colors.faint, fontSize: 11 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.muted, fontSize: 12 },
  sigRow: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  sigHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  sigTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  sigValue: { color: colors.text, fontSize: 14, fontWeight: "700" },
  sigDetail: { color: colors.muted, fontSize: 13 },
  sigRule: { color: colors.faint, fontSize: 11, lineHeight: 15 },
});
