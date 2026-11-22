import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BeadStrip } from "@/components/Avatar";
import { BarList, LineChart, type YBand } from "@/components/charts";
import { Card, Chips, SectionTitle } from "@/components/ui";
import type { SubmissionListItem } from "@/lib/api";
import { defectName } from "@/lib/defects";
import { SIGNAL_RULES, defectSignal, isCrack, straightSignal, widthSignal, type Signal } from "@/lib/signals";
import { SignalDot } from "@/screens/ResultCharts";
import { colors, space } from "@/theme";

type Tab = "trend" | "defects" | "compare";
type Row = SubmissionListItem;

export const num = (v: number | null | undefined) => (v == null ? null : Number(v));
export const groupOf = (r: { process: string | null; position: string | null }) =>
  [r.process, r.position].filter(Boolean).join(" ") || "—";
const rangeOf = (r: Row) => {
  const lo = num(r.width_min_mm);
  const hi = num(r.width_max_mm);
  return lo == null || hi == null ? null : hi - lo;
};
const HL = colors.primary; // 지금 보고 있는 회차 표시 색

// 신호등 기준을 그래프 배경 띠로 (초록/노랑/빨강)
const bandsFor = (rule: { green: number; yellow: number }): YBand[] => [
  { y0: 0, y1: rule.green, color: "rgba(34,197,94,0.10)" },
  { y0: rule.green, y1: rule.yellow, color: "rgba(245,158,11,0.10)" },
  { y0: rule.yellow, y1: 1000, color: "rgba(239,68,68,0.10)" },
];

function useDateOf() {
  const { i18n } = useTranslation();
  return (r: Row) => new Date(r.created_at).toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" });
}

/** 결과 화면 아래: 같은 용접법·자세의 누적 분석 (④ 실력 추이 기본, ⑤ 결함 통계, ⑥ 이전 대비)
 * rows = 같은 용접법·자세의 성공한 분석 전체(오래된 → 최근), currentId = 지금 보고 있는 분석 */
export function Cumulative({ rows, currentId, group }: { rows: Row[]; currentId: string; group: string }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("trend");
  const cur = Math.max(0, rows.findIndex((r) => r.id === currentId));
  return (
    <>
      <SectionTitle>{t("cum_title", { group })}</SectionTitle>
      <Card>
        <Chips<Tab>
          options={[
            { value: "trend", label: t("records_tabTrend") },
            { value: "defects", label: t("records_tabDefects") },
            { value: "compare", label: t("records_tabCompare") },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Text style={styles.hint}>{t("cum_count", { count: rows.length, n: cur + 1 })}</Text>
        {tab === "trend" ? (
          <Trend rows={rows} cur={cur} />
        ) : tab === "defects" ? (
          <Defects rows={rows} />
        ) : (
          <Compare rows={rows} cur={cur} />
        )}
      </Card>
    </>
  );
}

/** ④ 실력 추이: 회차별 폭 평균 · 폭 균일성 · 직진도. 지금 회차는 큰 주황 점 */
function Trend({ rows, cur }: { rows: Row[]; cur: number }) {
  const { t } = useTranslation();
  const dateOf = useDateOf();
  if (rows.length < 2) return <Text style={styles.empty}>{t("records_needMore")}</Text>;
  const pts = (f: (r: Row) => number | null) =>
    rows.flatMap((r, i) => {
      const v = f(r);
      return v == null ? [] : [[i + 1, v] as [number, number]];
    });
  const mark = (f: (r: Row) => number | null) => {
    const v = f(rows[cur]);
    return v == null ? [] : [{ x: cur + 1, y: v, color: HL, r: 7 }];
  };
  const N = rows.length;
  const step = Math.max(1, Math.ceil(N / 5));
  const at = Array.from({ length: N }, (_, i) => i + 1).filter((i) => (i - 1) % step === 0 || i === N);
  const common = { xTicksAt: at, xLabel: (x: number) => dateOf(rows[Math.round(x) - 1]), height: 150 };
  const width = (r: Row) => num(r.width_mean_mm);
  const straight = (r: Row) => num(r.straight_max_dev_mm);
  return (
    <View style={{ gap: space.md }}>
      <Text style={styles.chartTitle}>{t("records_trendWidth")}</Text>
      <LineChart {...common} series={[{ points: pts(width), color: "#3CDC3C", dots: true }]} markers={mark(width)} />
      <Text style={styles.chartTitle}>{t("records_trendRange")}</Text>
      <LineChart
        {...common}
        yMin={0}
        yMax={Math.max(SIGNAL_RULES.widthRange.yellow * 1.3, ...pts(rangeOf).map((p) => p[1] * 1.15))}
        ybands={bandsFor(SIGNAL_RULES.widthRange)}
        series={[{ points: pts(rangeOf), color: "#38BDF8", dots: true }]}
        markers={mark(rangeOf)}
      />
      <Text style={styles.chartTitle}>{t("records_trendStraight")}</Text>
      <LineChart
        {...common}
        yMin={0}
        yMax={Math.max(SIGNAL_RULES.straight.yellow * 1.3, ...pts(straight).map((p) => p[1] * 1.15))}
        ybands={bandsFor(SIGNAL_RULES.straight)}
        series={[{ points: pts(straight), color: "#FFE600", dots: true }]}
        markers={mark(straight)}
      />
      <Text style={styles.hint}>{t("records_trendHint")}</Text>
      <Text style={styles.hint}>{t("cum_currentHint")}</Text>
    </View>
  );
}

/** ⑤ 결함 통계: 종류별 횟수 */
function Defects({ rows }: { rows: Row[] }) {
  const { t } = useTranslation();
  const counts = new Map<string, number>();
  for (const r of rows) for (const d of r.defect_types ?? []) counts.set(d, (counts.get(d) ?? 0) + 1);
  const free = rows.filter((r) => (r.defect_types ?? []).length === 0 && (r.defect_count ?? 0) === 0).length;
  const items = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([type, value]) => ({ label: defectName(type), value, color: isCrack(type) ? colors.danger : colors.primary }));
  return (
    <View style={{ gap: space.md }}>
      <Text style={styles.big}>{t("records_defectFree", { free, total: rows.length })}</Text>
      {items.length ? <BarList items={items} /> : <Text style={styles.empty}>{t("records_defectNone")}</Text>}
    </View>
  );
}

/** ⑥ 이전 대비: 이 결과 vs 바로 전 결과 */
function Compare({ rows, cur }: { rows: Row[]; cur: number }) {
  const { t } = useTranslation();
  const dateOf = useDateOf();
  if (cur < 1) return <Text style={styles.empty}>{t(rows.length < 2 ? "records_needMore" : "cum_firstRecord")}</Text>;
  const now = rows[cur];
  const prev = rows[cur - 1];
  const items: { label: string; a: number | null; b: number | null; unit: string; lowerBetter: boolean; digits: number }[] = [
    { label: t("result_widthMean"), a: num(prev.width_mean_mm), b: num(now.width_mean_mm), unit: "mm", lowerBetter: false, digits: 1 },
    { label: t("signal_width"), a: rangeOf(prev), b: rangeOf(now), unit: "mm", lowerBetter: true, digits: 1 },
    { label: t("result_widthStd"), a: num(prev.width_std_mm), b: num(now.width_std_mm), unit: "mm", lowerBetter: true, digits: 2 },
    { label: t("signal_straight"), a: num(prev.straight_max_dev_mm), b: num(now.straight_max_dev_mm), unit: "mm", lowerBetter: true, digits: 1 },
    { label: t("signal_defects"), a: num(prev.defect_count), b: num(now.defect_count), unit: "", lowerBetter: true, digits: 0 },
  ];
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.cmpRow}>
        <Text style={[styles.cmpLabel, styles.cmpHead]}> </Text>
        <Text style={[styles.cmpVal, styles.cmpHead]}>{`${t("records_prev")}\n${dateOf(prev)}`}</Text>
        <Text style={[styles.cmpVal, styles.cmpHead]}>{`${t("records_latest")}\n${dateOf(now)}`}</Text>
        <View style={styles.cmpArrow} />
      </View>
      {items.map((it) => {
        const fmt = (v: number | null) => (v == null ? "—" : `${v.toFixed(it.digits)}${it.unit ? ` ${it.unit}` : ""}`);
        let icon: "arrow-up" | "arrow-down" | "remove" = "remove";
        let color = colors.muted;
        let word = t("records_same");
        if (it.a != null && it.b != null) {
          const d = it.b - it.a;
          const eps = it.digits === 0 ? 0.5 : 0.05;
          if (Math.abs(d) >= eps) {
            if (!it.lowerBetter) {
              icon = d > 0 ? "arrow-up" : "arrow-down";
              word = t("records_refOnly");
            } else {
              const better = d < 0;
              icon = better ? "arrow-up" : "arrow-down";
              color = better ? colors.success : colors.danger;
              word = better ? t("records_better") : t("records_worse");
            }
          }
        } else word = "";
        return (
          <View key={it.label} style={styles.cmpRow}>
            <Text style={styles.cmpLabel}>{it.label}</Text>
            <Text style={styles.cmpVal}>{fmt(it.a)}</Text>
            <Text style={[styles.cmpVal, { color: colors.text, fontWeight: "700" }]}>{fmt(it.b)}</Text>
            <View style={styles.cmpArrow}>
              <Ionicons name={icon} size={16} color={color} />
              <Text style={[styles.cmpWord, { color }]}>{word}</Text>
            </View>
          </View>
        );
      })}
      <Text style={styles.hint}>{t("records_compareHint")}</Text>
    </View>
  );
}

function LabeledDot({ label, signal }: { label: string; signal: Signal | null }) {
  return (
    <View style={styles.dotCol}>
      <SignalDot size={12} signal={signal} />
      <Text style={styles.dotLabel}>{label}</Text>
    </View>
  );
}

/** 기록 목록 위 설명: 숫자와 점 3개가 무엇인지, 색이 무엇인지 */
export function RecordLegend() {
  const { t } = useTranslation();
  return (
    <View style={styles.recLegend}>
      <Text style={styles.recLegendText}>{t("records_legendWhat")}</Text>
      <View style={styles.recLegendColors}>
        {(["green", "yellow", "red"] as const).map((s) => (
          <View key={s} style={styles.recLegendItem}>
            <SignalDot size={12} signal={s} />
            <Text style={styles.recLegendText}>{t(`signal_${s}`)}</Text>
          </View>
        ))}
        <View style={styles.recLegendItem}>
          <SignalDot size={12} signal={null} />
          <Text style={styles.recLegendText}>{t("records_legendNone")}</Text>
        </View>
      </View>
      <Text style={styles.recLegendHint}>{t("records_legendHint")}</Text>
    </View>
  );
}

/** 날짜별로 묶은 기록 목록 (내 기록·사람 기록 공통). 최근 → 예전 */
export function DatedRecords({ rows }: { rows: Row[] }) {
  const { i18n } = useTranslation();
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const out: React.ReactNode[] = [];
  let lastDay = "";
  for (const r of sorted) {
    const d = new Date(r.created_at).toLocaleDateString(i18n.language, { year: "numeric", month: "long", day: "numeric", weekday: "short" });
    if (d !== lastDay) {
      out.push(<Text key={`d-${d}`} style={styles.day}>{d}</Text>);
      lastDay = d;
    }
    out.push(<RecordRow key={r.id} r={r} />);
  }
  return <>{out}</>;
}

/** 분석 기록 한 줄 (누르면 그 결과 화면). current = 지금 보고 있는 것 */
export function RecordRow({ r, current, showInfo = true }: { r: Row; current?: boolean; showInfo?: boolean }) {
  const { t, i18n } = useTranslation();
  const date = new Date(r.created_at).toLocaleString(i18n.language);
  const info = [r.process, r.position, r.material].filter(Boolean).join(" · ") || t("result_title");
  return (
    <Card
      onPress={current ? undefined : () => router.push(`/result/${r.id}`)}
      style={current ? { ...styles.rowCard, ...styles.rowCurrent } : styles.rowCard}
    >
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{showInfo ? info : date}</Text>
          <Text style={styles.meta}>
            {showInfo ? date : ""}
            {current ? `${showInfo ? "  " : ""}${t("cum_viewing")}` : ""}
          </Text>
        </View>
        {r.status === "ok" ? (
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <Text style={styles.value}>{r.width_mean_mm != null ? `${Number(r.width_mean_mm).toFixed(1)} mm` : "—"}</Text>
            <View style={styles.dots}>
              <LabeledDot label={t("dot_width")} signal={widthSignal(num(r.width_min_mm), num(r.width_max_mm))} />
              <LabeledDot label={t("dot_straight")} signal={straightSignal(num(r.straight_max_dev_mm))} />
              <LabeledDot label={t("dot_defects")} signal={defectSignal(r.defect_types)} />
            </View>
          </View>
        ) : (
          <Text style={styles.bad}>{t(r.status === "processing" ? "status_processing" : "status_short_failed")}</Text>
        )}
      </View>
      {/* 비드 그림 (결과 화면 확인 그림을 줄인 것) */}
      {r.status === "ok" ? <BeadStrip url={r.bead_url} cacheKey={r.bead_key} ratio={r.bead_ratio} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.faint, fontSize: 11 },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 20, paddingVertical: space.lg, textAlign: "center" },
  chartTitle: { color: colors.text, fontSize: 13, fontWeight: "700" },
  big: { color: colors.text, fontSize: 15, fontWeight: "700" },
  cmpRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cmpHead: { color: colors.faint, fontSize: 11 },
  cmpLabel: { flex: 1.4, color: colors.muted, fontSize: 13 },
  cmpVal: { flex: 1, color: colors.muted, fontSize: 13, textAlign: "right" },
  cmpArrow: { width: 74, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 },
  cmpWord: { fontSize: 11 },
  rowCard: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  rowCurrent: { borderColor: colors.primary, borderWidth: 1 },
  title: { color: colors.text, fontWeight: "700", fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  value: { color: colors.text, fontWeight: "700", fontSize: 16 },
  dots: { flexDirection: "row", gap: 6 },
  day: { color: colors.muted, fontSize: 13, fontWeight: "700", marginTop: 8 },
  dotCol: { alignItems: "center", gap: 2, minWidth: 28 },
  dotLabel: { color: colors.muted, fontSize: 10 },
  recLegend: { gap: 4, paddingHorizontal: 2 },
  recLegendColors: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  recLegendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  recLegendText: { color: colors.muted, fontSize: 12 },
  recLegendHint: { color: colors.faint, fontSize: 11 },
  bad: { color: colors.danger, fontSize: 13 },
});
