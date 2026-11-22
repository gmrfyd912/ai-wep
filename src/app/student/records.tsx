import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Screen } from "@/components/ui";
import { listSubmissions, type SubmissionListItem } from "@/lib/api";
import { DatedRecords, RecordLegend } from "@/screens/Cumulative";
import { colors } from "@/theme";

/** 내 기록: 모든 분석을 날짜별로 모은 목록. 누르면 그 결과 화면(누적 분석 포함)이 열린다 (교육생·교사 공통) */
export default function RecordsScreen() {
  const { t } = useTranslation();
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

  const latestOk = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((r) => r.status === "ok");
  return (
    <Screen>
      {latestOk ? (
        <AppButton label={t("records_openLatest")} icon="analytics-outline" onPress={() => router.push(`/result/${latestOk.id}`)} />
      ) : null}
      <Text style={styles.hint}>{t("records_listHint")}</Text>
      <RecordLegend />
      <DatedRecords rows={rows} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.faint, fontSize: 12 },
  error: { color: colors.danger, fontSize: 14 },
});
