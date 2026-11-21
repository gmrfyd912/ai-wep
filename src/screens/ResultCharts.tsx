import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { LineChart } from "@/components/charts";
import { Card, Chips } from "@/components/ui";
import type { EngineResult } from "@/lib/api";
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

/** 결과 화면 위쪽: ① 폭 변화 ② 직진도 ③ 신호등 (기본 ①) */
export function ResultCharts({ result }: { result: EngineResult }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("width");
  const bead = result.bead;
  if (!bead) return null;
  const L = bead.length_mm;
  const trim = bead.width.end_trim_mm ?? 10;
  const ends = L > 2 * trim ? [{ x0: 0, x1: trim, color: GRAY }, { x0: L - trim, x1: L, color: GRAY }] : [];
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
            <Legend items={[[C.width, t("chart_widthY")], [C.mean, t("chart_mean")], [C.min, t("result_widthMin")], [C.max, t("result_widthMax")], [GRAY, t("legend_excluded")]]} />
          </>
        ) : (
          <Text style={styles.empty}>{t("chart_noData")}</Text>
        )
      ) : tab === "straight" ? (
        bead.straightness.profile?.length ? (
          <>
            <Text style={styles.axis}>{t("chart_devY")}</Text>
            <LineChart
              series={[{ points: bead.straightness.profile, color: C.center }]}
              bands={ends}
              ybands={[{ y0: -SIGNAL_RULES.straight.green, y1: SIGNAL_RULES.straight.green, color: "rgba(34,197,94,0.10)" }]}
              hlines={[{ y: 0, color: C.base }]}
              markers={(() => {
                const p = bead.straightness.max_dev_pos_mm;
                if (p == null) return [];
                const hit = bead.straightness.profile!.reduce((a, b) => (Math.abs(b[0] - p) < Math.abs(a[0] - p) ? b : a));
                return [{ x: hit[0], y: hit[1], color: C.dev }];
              })()}
              yMin={Math.min(-1.5, ...bead.straightness.profile.map((q) => q[1] * 1.15))}
              yMax={Math.max(1.5, ...bead.straightness.profile.map((q) => q[1] * 1.15))}
              xLabel={mmLabel}
              caption={t("chart_xDist")}
            />
            <Legend items={[[C.center, t("legend_center")], [C.base, t("legend_baseline")], [C.dev, t("legend_maxDev")], ["rgba(34,197,94,0.35)", t("chart_greenZone", { mm: SIGNAL_RULES.straight.green })]]} />
          </>
        ) : (
          <Text style={styles.empty}>{t("chart_noStraightData")}</Text>
        )
      ) : (
        <SignalPanel result={result} />
      )}
    </Card>
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

function Legend({ items }: { items: [string, string][] }) {
  return (
    <View style={styles.legend}>
      {items.map(([c, label]) => (
        <View key={label} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: c }]} />
          <Text style={styles.legendText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  axis: { color: colors.muted, fontSize: 11 },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 20, paddingVertical: space.lg, textAlign: "center" },
  note: { color: colors.faint, fontSize: 11 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: colors.muted, fontSize: 11 },
  sigRow: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  sigHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm },
  sigTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  sigValue: { color: colors.text, fontSize: 14, fontWeight: "700" },
  sigDetail: { color: colors.muted, fontSize: 13 },
  sigRule: { color: colors.faint, fontSize: 11, lineHeight: 15 },
});
