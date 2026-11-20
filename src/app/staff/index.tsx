import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Card, PreviewNotice, Screen } from "@/components/ui";
import { COURSES, STUDENTS } from "@/mock/data";
import { colors, space } from "@/theme";

/** 행정 관리자: 모든 과정을 한눈에 보는 과정 보드 */
export default function StaffHome() {
  const { t } = useTranslation();

  return (
    <Screen>
      {COURSES.filter((c) => c.active).map((c) => {
        const students = STUDENTS.filter((s) => s.courseId === c.id);
        const avg = students.length
          ? Math.round(students.reduce((sum, s) => sum + s.lastScore, 0) / students.length)
          : 0;
        return (
          <Card key={c.id} onPress={() => router.push(`/course/${c.id}`)}>
            <View style={styles.top}>
              <Text style={styles.name}>{c.name}</Text>
              <View style={{ flex: 1 }} />
              <Text style={styles.link}>{t("staff_openBoard")}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.primary} />
            </View>
            <View style={styles.stats}>
              <Stat label={t("teacher_students")} value={String(students.length)} />
              <Stat label={t("staff_weeklySubmissions")} value={String(c.weeklySubmissions)} />
              <Stat label={t("teacher_avgScore")} value={String(avg)} />
            </View>
            <Text style={styles.meta}>
              {t("staff_homeroom")}: {c.homeroom}
            </Text>
          </Card>
        );
      })}
      <PreviewNotice />
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { color: colors.text, fontSize: 18, fontWeight: "800" },
  link: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  stats: { flexDirection: "row", gap: space.sm },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: space.sm },
  statValue: { color: colors.primary, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 11, textAlign: "center" },
  meta: { color: colors.muted, fontSize: 13 },
});
