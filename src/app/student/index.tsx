import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Body, Card, ComingSoon, PreviewNotice, Screen, ScoreBadge, SectionTitle, Title } from "@/components/ui";
import { courseById, ME_STUDENT_ID, RESULTS, studentById } from "@/mock/data";
import { colors, space } from "@/theme";

export default function StudentHome() {
  const { t } = useTranslation();
  const me = studentById(ME_STUDENT_ID)!;
  const latest = RESULTS.find((r) => r.studentId === me.id);

  return (
    <Screen>
      <Title>{t("home_greeting", { name: me.name })}</Title>
      <Text style={styles.course}>{courseById(me.courseId)?.name}</Text>

      <Card onPress={() => router.push("/student/upload")} style={styles.cta}>
        <Ionicons name="camera" size={32} color={colors.text} />
        <View style={{ flex: 1 }}>
          <Text style={styles.ctaTitle}>{t("home_uploadCta")}</Text>
          <Text style={styles.ctaDesc}>{t("home_uploadCtaDesc")}</Text>
        </View>
      </Card>

      {latest ? (
        <>
          <SectionTitle>{t("home_recentResult")}</SectionTitle>
          <Card onPress={() => router.push(`/result/${latest.id}`)} style={styles.row}>
            <Ionicons name="analytics-outline" size={24} color={colors.primary} />
            <Body>{t("result_title")}</Body>
            <View style={{ flex: 1 }} />
            <ScoreBadge score={latest.score} />
          </Card>
        </>
      ) : null}

      <SectionTitle>{t("home_theory")}</SectionTitle>
      <Card>
        <Body muted>{t("home_theoryDesc")}</Body>
      </Card>
      <ComingSoon step={3} />
      <PreviewNotice />
    </Screen>
  );
}

const styles = StyleSheet.create({
  course: { color: colors.primary, fontWeight: "700" },
  cta: { flexDirection: "row", alignItems: "center", gap: space.md, backgroundColor: colors.primary, borderColor: colors.primary },
  ctaTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  ctaDesc: { color: colors.text, opacity: 0.85, fontSize: 13, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
});
