import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { BarList, LineChart, type YBand } from "@/components/charts";
import { Body, Card, Chips, Screen, SectionTitle } from "@/components/ui";
import { listSubmissions, type SubmissionListItem } from "@/lib/api";
import { defectName } from "@/lib/defects";
import { SIGNAL_RULES, defectSignal, isCrack, straightSignal, widthSignal } from "@/lib/signals";
import { SignalDot } from "@/screens/ResultCharts";
import { colors, space } from "@/theme";

type Tab = "trend" | "defects" | "compare";
const ALL = "__all__";

const n = (v: number | null | undefined) => (v == null ? null : Number(v));
const groupOf = (r: SubmissionListItem) => [r.process, r.position].filter(Boolean).join(" ") || "—";
const rangeOf = (r: SubmissionListItem) => {
  const lo = n(r.width_min_mm);
  const hi = n(r.width_max_mm);
  return lo == null || hi == null ? null : hi - lo;
};

// 신호등 기준을 그래프 배경 띠로 (초록/노랑/빨강)
const bandsFor = (rule: { green: number; yellow: number }): YBand[] => [
  { y0: 0, y1: rule.green, color: "rgba(34,197,94,0.10)" },
  { y0: rule.green, y1: rule.yellow, color: "rgba(245,158,11,0.10)" },
  { y0: rule.yellow, y1: 1000, color: "rgba(239,68,68,0.10)" },
];

export default function RecordsScreen() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<SubmissionListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("trend");
  const [group, setGroup] = useState<string | null>(null);

  // 탭에 들어올 때마다 새로 불러온다 (방금 올린 분석이 바로 보이게)
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      setFailed(false);
      listSubmissions()
        .then((r) => alive && setRows(r))
        .catch(() => alive && setFailed(true));
      return () => {
        alive = false;
      };
    }, []),
  );

  // 성공한 분석만, 오래된 것 → 최근 순
  const ok = useMemo(
    () => (rows ?? []).filter((r) => r.status === "ok").sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [rows],
  );
  // 용접법·자세 목록 (최근에 한 것부터). 기본 선택 = 가장 최근 분석의 용접법·자세
  const groups = useMemo(() => [...new Set([...ok].reverse().map(groupOf))], [ok]);
  const current = group ?? groups[0] ?? ALL;
  const sel = current === ALL ? ok : ok.filter((r) => groupOf(r) === current);

  const dateOf = (r: SubmissionListItem) =>
    new Date(r.created_at).toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" });

  return (
    <Screen>
      <SectionTitle>{t("records_analysis")}</SectionTitle>
      {failed ? (
        <Text style={styles.error}>{t("error_network")}</Text>
      ) : rows == null ? (
        <ActivityIndicator color={colors.primary} />
      ) : ok.length === 0 ? (
        <Body muted>{t("records_empty")}</Body>
      ) : (
        <>
          {groups.length > 1 || groups[0] !== "—" ? (
            <>
              <Chips<string>
                options={[
                  ...groups.map((g) => ({ value: g, label: g })),
                  { value: ALL, label: t("records_filterAll") },
                ]}
                value={current}
                onChange={setGroup}
              />
              <Text style={styles.hint}>{t("records_filterHint")}</Text>
            </>
          ) : null}
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
            <Text style={styles.hint}>{t("records_count", { count: sel.length })}</Text>
            {tab === "trend" ? (
              <Trend rows={sel} dateOf={dateOf} />
            ) : tab === "defects" ? (
              <Defects rows={sel} />
            ) : (
              <Compare rows={sel} dateOf={dateOf} />
            )}
          </Card>
          <Text style={styles.note}>{t("signal_note")}</Text>
        </>
      )}

      <SectionTitle>{t("records_title")}</SectionTitle>
      {rows && rows.length > 0
        ? [...rows]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((r) => (
              <Card key={r.id} onPress={() => router.push(`/result/${r.id}`)} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>
                    {[r.process, r.position, r.material].filter(Boolean).join(" · ") || t("result_title")}
                  </Text>
                  <Text style={styles.meta}>{new Date(r.created_at).toLocaleString(i18n.language)}</Text>
                </View>
                {r.status === "ok" ? (
                  <View style={{ alignItems: "flex-end", gap: 4 }}>
                    <Text style={styles.value}>
                      {r.width_mean_mm != null ? `${Number(r.width_mean_mm).toFixed(1)} mm` : "—"}
                    </Text>
                    <View style={styles.dots}>
                      <SignalDot size={10} signal={widthSignal(n(r.width_min_mm), n(r.width_max_mm))} />
                      <SignalDot size={10} signal={straightSignal(n(r.straight_max_dev_mm))} />
                      <SignalDot size={10} signal={defectSignal(r.defect_types)} />
                    </View>
                  </View>
                ) : (
                  <Text style={styles.bad}>
                    {t(r.status === "processing" ? "status_processing" : "status_short_failed")}
                  </Text>
                )}
              </Card>
            ))
        : null}
    </Screen>
  );
}

/** ④ 실력 추이: 회차별 폭 평균 · 폭 균일성 · 직진도 */
function Trend({ rows, dateOf }: { rows: SubmissionListItem[]; dateOf: (r: SubmissionListItem) => string }) {
  const { t } = useTranslation();
  if (rows.length < 2) return <Text style={styles.empty}>{t("records_needMore")}</Text>;
  const pts = (f: (r: SubmissionListItem) => number | null) =>
    rows.flatMap((r, i) => {
      const v = f(r);
      return v == null ? [] : [[i + 1, v] as [number, number]];
    });
  const N = rows.length;
  const step = Math.max(1, Math.ceil(N / 5));
  const at = Array.from({ length: N }, (_, i) => i + 1).filter((i) => (i - 1) % step === 0 || i === N);
  const label = (x: number) => dateOf(rows[Math.round(x) - 1]);
  const common = { xTicksAt: at, xLabel: label, height: 150 };
  return (
    <View style={{ gap: space.md }}>
      <Text style={styles.chartTitle}>{t("records_trendWidth")}</Text>
      <LineChart {...common} series={[{ points: pts((r) => n(r.width_mean_mm)), color: "#3CDC3C", dots: true }]} />
      <Text style={styles.chartTitle}>{t("records_trendRange")}</Text>
      <LineChart
        {...common}
        yMin={0}
        yMax={Math.max(SIGNAL_RULES.widthRange.yellow * 1.3, ...pts(rangeOf).map((p) => p[1] * 1.15))}
        ybands={bandsFor(SIGNAL_RULES.widthRange)}
        series={[{ points: pts(rangeOf), color: colors.primary, dots: true }]}
      />
      <Text style={styles.chartTitle}>{t("records_trendStraight")}</Text>
      <LineChart
        {...common}
        yMin={0}
        yMax={Math.max(SIGNAL_RULES.straight.yellow * 1.3, ...pts((r) => n(r.straight_max_dev_mm)).map((p) => p[1] * 1.15))}
        ybands={bandsFor(SIGNAL_RULES.straight)}
        series={[{ points: pts((r) => n(r.straight_max_dev_mm)), color: "#FFE600", dots: true }]}
      />
      <Text style={styles.hint}>{t("records_trendHint")}</Text>
    </View>
  );
}

/** ⑤ 결함 통계: 종류별 횟수 */
function Defects({ rows }: { rows: SubmissionListItem[] }) {
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

/** ⑥ 이전 대비: 가장 최근 결과와 바로 전 결과 */
function Compare({ rows, dateOf }: { rows: SubmissionListItem[]; dateOf: (r: SubmissionListItem) => string }) {
  const { t } = useTranslation();
  if (rows.length < 2) return <Text style={styles.empty}>{t("records_needMore")}</Text>;
  const cur = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const items: { label: string; a: number | null; b: number | null; unit: string; lowerBetter: boolean; digits: number }[] = [
    { label: t("result_widthMean"), a: n(prev.width_mean_mm), b: n(cur.width_mean_mm), unit: "mm", lowerBetter: false, digits: 1 },
    { label: t("signal_width"), a: rangeOf(prev), b: rangeOf(cur), unit: "mm", lowerBetter: true, digits: 1 },
    { label: t("result_widthStd"), a: n(prev.width_std_mm), b: n(cur.width_std_mm), unit: "mm", lowerBetter: true, digits: 2 },
    { label: t("signal_straight"), a: n(prev.straight_max_dev_mm), b: n(cur.straight_max_dev_mm), unit: "mm", lowerBetter: true, digits: 1 },
    { label: t("signal_defects"), a: n(prev.defect_count), b: n(cur.defect_count), unit: "", lowerBetter: true, digits: 0 },
  ];
  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.cmpRow}>
        <Text style={[styles.cmpLabel, styles.cmpHead]}> </Text>
        <Text style={[styles.cmpVal, styles.cmpHead]}>{`${t("records_prev")}\n${dateOf(prev)}`}</Text>
        <Text style={[styles.cmpVal, styles.cmpHead]}>{`${t("records_latest")}\n${dateOf(cur)}`}</Text>
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

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  title: { color: colors.text, fontWeight: "700", fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  value: { color: colors.text, fontWeight: "700", fontSize: 16 },
  dots: { flexDirection: "row", gap: 4 },
  bad: { color: colors.danger, fontSize: 13 },
  error: { color: colors.danger, fontSize: 14 },
  hint: { color: colors.faint, fontSize: 11 },
  note: { color: colors.faint, fontSize: 11, textAlign: "center" },
  empty: { color: colors.muted, fontSize: 14, lineHeight: 20, paddingVertical: space.lg, textAlign: "center" },
  chartTitle: { color: colors.text, fontSize: 13, fontWeight: "700" },
  big: { color: colors.text, fontSize: 15, fontWeight: "700" },
  cmpRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cmpHead: { color: colors.faint, fontSize: 11 },
  cmpLabel: { flex: 1.4, color: colors.muted, fontSize: 13 },
  cmpVal: { flex: 1, color: colors.muted, fontSize: 13, textAlign: "right" },
  cmpArrow: { width: 74, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2 },
  cmpWord: { fontSize: 11 },
});
