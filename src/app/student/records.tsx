import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Card, ComingSoon, ImagePlaceholder, PreviewNotice, Screen, ScoreBadge, SectionTitle } from "@/components/ui";
import { ME_STUDENT_ID, RESULTS } from "@/mock/data";
import { colors, space } from "@/theme";

export default function RecordsScreen() {
  const { t } = useTranslation();
  const mine = RESULTS.filter((r) => r.studentId === ME_STUDENT_ID);

  return (
    <Screen>
      <SectionTitle>{t("records_trend")}</SectionTitle>
      <ImagePlaceholder height={140} />
      <ComingSoon step={4} />
      <SectionTitle>{t("records_title")}</SectionTitle>
      {mine.map((r) => (
        <Card key={r.id} onPress={() => router.push(`/result/${r.id}`)} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{t("result_title")}</Text>
            <Text style={styles.meta}>
              {t("result_width")} {r.widthDevMm} mm · {t("result_straightness")} {r.straightDevMm} mm
            </Text>
          </View>
          <ScoreBadge score={r.score} />
        </Card>
      ))}
      <PreviewNotice />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  title: { color: colors.text, fontWeight: "700", fontSize: 15 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
