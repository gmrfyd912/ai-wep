import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Screen } from "@/components/ui";
import { clearTutorReport, listTutorReports, type TutorReport } from "@/lib/api";
import { textbookError } from "@/screens/TextbookParts";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

/** 시스템관리자: 교육생·교사가 "답이 이상해요"로 신고한 웰디 대답 */
export default function TutorReportsScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const [items, setItems] = useState<TutorReport[] | null>(null);
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      listTutorReports()
        .then((r) => setItems(r.items))
        .catch((e) => setError(textbookError(t, e)));
    }, [t]),
  );

  if (user?.role !== "admin") return <Redirect href="/" />;

  const done = async (id: string) => {
    try {
      await clearTutorReport(id);
      setItems((cur) => (cur ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setError(textbookError(t, e));
    }
  };

  return (
    <Screen>
      <Body muted>{t("tutor_reportsIntro")}</Body>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!items && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {items && items.length === 0 ? <Body muted>{t("tutor_reportsNone")}</Body> : null}
      {(items ?? []).map((r) => (
        <Card key={r.id} style={{ gap: space.sm }}>
          <Text style={styles.small}>
            {r.name} · {r.reported_at ? r.reported_at.slice(0, 16).replace("T", " ") : ""} · {r.lang}
          </Text>
          <View style={{ gap: 2 }}>
            <Text style={styles.label}>{t("tutor_reportsQ")}</Text>
            <Text style={styles.text}>{r.question}</Text>
          </View>
          <View style={{ gap: 2 }}>
            <Text style={styles.label}>{t("tutor_reportsA")}</Text>
            <Text style={styles.text}>{r.answer}</Text>
            {r.printed.length ? <Text style={styles.small}>{r.printed.map((p) => `p.${p}`).join(", ")}</Text> : null}
          </View>
          {r.report_note ? <Text style={styles.note}>⚑ {r.report_note}</Text> : null}
          <AppButton label={t("tutor_reportsDone")} icon="checkmark-outline" variant="secondary" onPress={() => done(r.id)} />
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
  small: { color: colors.muted, fontSize: 12 },
  label: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  note: { color: colors.warning, fontSize: 13 },
});
