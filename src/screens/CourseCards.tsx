import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Body, Card } from "@/components/ui";
import { listCourseCards, type CourseCard } from "@/lib/api";
import { TeacherLine } from "@/screens/TeacherBoard";
import { colors, space } from "@/theme";

/** 행정 관리자·시스템관리자 과정 보드: 운영 중인 과정마다 카드 한 장 (누르면 그 반 교사 보드) */
export function CourseCards() {
  const { t } = useTranslation();
  const [cards, setCards] = useState<CourseCard[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    listCourseCards()
      .then(setCards)
      .catch(() => setFailed(true));
  }, []);
  useFocusEffect(load);

  if (failed) {
    return (
      <Card onPress={load}>
        <Text style={{ color: colors.danger }}>{t("error_network")}</Text>
      </Card>
    );
  }
  if (!cards) return <ActivityIndicator color={colors.primary} />;
  if (cards.length === 0) return <Body muted>{t("board_noCourses")}</Body>;

  return (
    <>
      {cards.map((c) => (
        <Card key={c.id} onPress={() => router.push({ pathname: "/course/[id]", params: { id: c.id, name: c.name } })}>
          <View style={styles.top}>
            <Text style={styles.name}>{c.name}</Text>
            {c.pending_count ? (
              <Text style={styles.pending}>{t("board_pending", { count: c.pending_count })}</Text>
            ) : null}
            <View style={{ flex: 1 }} />
            <Text style={styles.link}>{t("staff_openBoard")}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
          </View>
          <View style={styles.stats}>
            <Stat label={t("teacher_students")} value={String(c.student_count)} />
            <Stat label={t("staff_weeklySubmissions")} value={String(c.weekly_submissions)} />
            <Stat label={t("teacher_avgScore")} value={c.avg_score == null ? "—" : String(c.avg_score)} />
          </View>
          <TeacherLine teachers={c.teachers} />
        </Card>
      ))}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: colors.text, fontSize: 18, fontWeight: "800" },
  pending: { color: colors.warning, fontSize: 12, fontWeight: "700" },
  link: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  stats: { flexDirection: "row", gap: space.sm },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: space.sm },
  statValue: { color: colors.primary, fontSize: 20, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 11, textAlign: "center" },
});
