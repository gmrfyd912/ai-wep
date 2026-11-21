import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Body, Card, ComingSoon, ImagePlaceholder, Screen, SectionTitle } from "@/components/ui";
import { listSubmissions, type SubmissionSummary } from "@/lib/api";
import { colors, space } from "@/theme";

export default function RecordsScreen() {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<SubmissionSummary[] | null>(null);
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

  return (
    <Screen>
      <SectionTitle>{t("records_trend")}</SectionTitle>
      <ImagePlaceholder height={140} />
      <ComingSoon step={4} />
      <SectionTitle>{t("records_title")}</SectionTitle>
      {failed ? (
        <Text style={styles.error}>{t("error_network")}</Text>
      ) : rows == null ? (
        <ActivityIndicator color={colors.primary} />
      ) : rows.length === 0 ? (
        <Body muted>{t("records_empty")}</Body>
      ) : (
        rows.map((r) => (
          <Card key={r.id} onPress={() => router.push(`/result/${r.id}`)} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {[r.process, r.position, r.material].filter(Boolean).join(" · ") || t("result_title")}
              </Text>
              <Text style={styles.meta}>{new Date(r.created_at).toLocaleString(i18n.language)}</Text>
            </View>
            {r.status === "ok" ? (
              <Text style={styles.value}>
                {r.width_mean_mm != null ? `${Number(r.width_mean_mm).toFixed(1)} mm` : "—"}
              </Text>
            ) : (
              <Text style={styles.bad}>{t(r.status === "processing" ? "status_processing" : "status_short_failed")}</Text>
            )}
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  title: { color: colors.text, fontWeight: "700", fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  value: { color: colors.text, fontWeight: "700", fontSize: 16 },
  bad: { color: colors.danger, fontSize: 13 },
  error: { color: colors.danger, fontSize: 14 },
});
