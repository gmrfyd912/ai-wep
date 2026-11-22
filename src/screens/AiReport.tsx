import Ionicons from "@expo/vector-icons/Ionicons";
import type { TFunction } from "i18next";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Card, SectionTitle } from "@/components/ui";
import { NetworkError, getReport, type ReportResponse, type ScoreInfo } from "@/lib/api";
import { defectName } from "@/lib/defects";
import { colors, radius, space } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

/** AI 리포트 탭. 탭을 처음 열 때 만들고(서버에 언어별로 저장), 언어가 바뀌면 그 언어로 다시 받는다.
 * 점수·예비판정은 서버 공식으로 계산된 값이라 AI 리포트가 실패해도 먼저 보여 준다. */
export function AiReport({ sid, score }: { sid: string; score: ScoreInfo | null | undefined }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [data, setData] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<NetworkError | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    setData(null);
    getReport(sid, lang)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof NetworkError ? e : new NetworkError(String(e))))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [sid, lang]);

  useEffect(() => load(), [load]);

  const sc = data?.score ?? score ?? null;
  if (!sc) {
    return (
      <Card>
        <Text style={styles.muted}>{t("report_notAnalyzed")}</Text>
      </Card>
    );
  }
  const r = data?.report;

  return (
    <>
      <ScoreCard sc={sc} />

      {loading ? (
        <Card style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.muted}>{t("report_writing")}</Text>
        </Card>
      ) : error ? (
        <Card>
          <Text style={styles.error}>{errorText(error, t)}</Text>
          {!["daily_limit", "ai_not_configured", "no_report"].includes(error.detail?.code ?? "") ? (
            <>
              <Text style={styles.code}>{error.detail?.code ?? error.code}</Text>
              <AppButton label={t("report_retry")} icon="refresh" variant="secondary" onPress={load} />
            </>
          ) : null}
        </Card>
      ) : r ? (
        <>
          <Card>
            <Text style={styles.summary}>{r.summary}</Text>
          </Card>
          <Section title={t("report_strengths")} icon="checkmark-circle" color={colors.success} items={r.strengths} />
          <Section title={t("report_improvements")} icon="construct" color={colors.warning} items={r.improvements} />
          <Section title={t("report_practice")} icon="barbell" color={colors.primary} items={r.practice} />
          <SectionTitle>{t("report_comparison")}</SectionTitle>
          <Card>
            <Text style={styles.item}>{r.comparison}</Text>
          </Card>
          {data && !data.cached && data.remaining != null ? (
            <Text style={styles.note}>{t("report_remaining", { n: data.remaining, limit: data.limit })}</Text>
          ) : null}
        </>
      ) : null}
      <Text style={styles.note}>{t("report_note")}</Text>
    </>
  );
}

function errorText(e: NetworkError, t: TFunction) {
  const code = e.detail?.code;
  if (code === "daily_limit") return t("report_limit", { limit: e.detail?.limit ?? 2 });
  if (code === "ai_not_configured") return t("report_notConfigured");
  if (code === "not_analyzed") return t("report_notAnalyzed");
  if (code === "no_report") return t("report_none");
  if (code === "ai_busy") return t("report_busy");
  if (e.status === 0) return t("error_network");
  return t("report_failed");
}

/** 점수(100점) + AI 예비판정 + 항목별 점수 */
function ScoreCard({ sc }: { sc: ScoreInfo }) {
  const { t } = useTranslation();
  const pass = sc.verdict === "pass";
  const vc = pass ? colors.success : colors.danger;
  const sColor = sc.score >= 85 ? colors.success : sc.score >= 70 ? colors.warning : colors.danger;
  const d = sc.parts.defects;
  const counted = d.items.filter((i) => i.minus > 0);
  const defectText = counted.length
    ? counted.map((i) => `${defectName(i.type)} −${i.minus}`).join(", ")
    : t("defect_none");
  return (
    <Card>
      <View style={styles.scoreRow}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
          <Text style={[styles.score, { color: sColor }]}>{sc.score}</Text>
          <Text style={styles.muted}>/ 100</Text>
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          <Text style={styles.verdictLabel}>{t("report_verdictLabel")}</Text>
          <View style={[styles.verdict, { borderColor: vc, backgroundColor: pass ? "#0F2A1A" : "#2A1212" }]}>
            <Text style={[styles.verdictText, { color: vc }]}>{t(pass ? "report_pass" : "report_fail")}</Text>
          </View>
        </View>
      </View>
      {sc.fail_reasons.length ? (
        <Text style={styles.error}>
          {t("report_failReason", { defects: sc.fail_reasons.map(defectName).join(", ") })}
        </Text>
      ) : null}
      {sc.fail_low_score ? (
        <Text style={styles.error}>{t("report_failLowScore", { pass: sc.pass_score ?? 80 })}</Text>
      ) : null}
      <Part
        label={t("report_partWidth")}
        sub={t("report_partWidthSub", { mm: sc.parts.width.value_mm.toFixed(1) })}
        points={sc.parts.width.points}
        max={sc.parts.width.max}
      />
      <Part
        label={t("report_partStraight")}
        sub={t("report_partStraightSub", { mm: sc.parts.straight.value_mm.toFixed(1) })}
        points={sc.parts.straight.points}
        max={sc.parts.straight.max}
      />
      <Part label={t("report_partDefects")} sub={defectText} points={d.points} max={d.max} />
      <Text style={styles.note}>{t("report_scoreNote", { pass: sc.pass_score ?? 80 })}</Text>
    </Card>
  );
}

function Part({ label, sub, points, max }: { label: string; sub: string; points: number; max: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, points / max)) : 0;
  return (
    <View style={{ gap: 4 }}>
      <View style={styles.partRow}>
        <Text style={styles.partLabel}>{label}</Text>
        <Text style={styles.partPoints}>
          {Math.round(points)} / {max}
        </Text>
      </View>
      <View style={styles.bar}>
        <View style={[styles.barFill, { width: `${ratio * 100}%` }]} />
      </View>
      <Text style={styles.partSub}>{sub}</Text>
    </View>
  );
}

function Section({ title, icon, color, items }: { title: string; icon: IconName; color: string; items: string[] }) {
  if (!items?.length) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card>
        {items.map((s, i) => (
          <View key={i} style={styles.itemRow}>
            <Ionicons name={icon} size={18} color={color} style={{ marginTop: 2 }} />
            <Text style={[styles.item, { flex: 1 }]}>{s}</Text>
          </View>
        ))}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", gap: space.sm, paddingVertical: space.xl },
  muted: { color: colors.muted, fontSize: 14, textAlign: "center" },
  error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  code: { color: colors.faint, fontSize: 11 },
  note: { color: colors.faint, fontSize: 12, textAlign: "center" },
  summary: { color: colors.text, fontSize: 16, fontWeight: "700", lineHeight: 24 },
  item: { color: colors.text, fontSize: 15, lineHeight: 22 },
  itemRow: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  scoreRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  score: { fontSize: 44, fontWeight: "900" },
  verdictLabel: { color: colors.faint, fontSize: 11 },
  verdict: { borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 4 },
  verdictText: { fontSize: 16, fontWeight: "800" },
  partRow: { flexDirection: "row", justifyContent: "space-between" },
  partLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  partPoints: { color: colors.text, fontSize: 14, fontWeight: "700" },
  partSub: { color: colors.faint, fontSize: 12 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.cardAlt, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3, backgroundColor: colors.primary },
});
