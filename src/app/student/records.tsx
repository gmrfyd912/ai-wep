import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Screen } from "@/components/ui";
import { listSubmissions, type SubmissionListItem } from "@/lib/api";
import { RecordRow } from "@/screens/Cumulative";
import { colors } from "@/theme";

/** 내 기록: 모든 분석을 날짜별로 모은 목록. 누르면 그 결과 화면(누적 분석 포함)이 열린다 */
export default function RecordsScreen() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<SubmissionListItem[] | null>(null);
  const [failed, setFailed] = useState(false);

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

  if (failed) return <Screen><Text style={styles.error}>{t("error_network")}</Text></Screen>;
  if (rows == null) return <Screen><ActivityIndicator color={colors.primary} /></Screen>;
  if (rows.length === 0) return <Screen><Body muted>{t("records_empty")}</Body></Screen>;

  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const latestOk = sorted.find((r) => r.status === "ok");
  const dayOf = (r: SubmissionListItem) =>
    new Date(r.created_at).toLocaleDateString(i18n.language, { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const out: React.ReactNode[] = [];
  let lastDay = "";
  for (const r of sorted) {
    const d = dayOf(r);
    if (d !== lastDay) {
      out.push(<Text key={`d-${d}`} style={styles.day}>{d}</Text>);
      lastDay = d;
    }
    out.push(<RecordRow key={r.id} r={r} />);
  }

  return (
    <Screen>
      {latestOk ? (
        <AppButton label={t("records_openLatest")} icon="analytics-outline" onPress={() => router.push(`/result/${latestOk.id}`)} />
      ) : null}
      <Text style={styles.hint}>{t("records_listHint")}</Text>
      {out}
    </Screen>
  );
}

const styles = StyleSheet.create({
  day: { color: colors.muted, fontSize: 13, fontWeight: "700", marginTop: 8 },
  hint: { color: colors.faint, fontSize: 12 },
  error: { color: colors.danger, fontSize: 14 },
});
