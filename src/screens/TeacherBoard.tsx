import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Card, ScoreBadge } from "@/components/ui";
import { courseById, STUDENTS, type Student } from "@/mock/data";
import { colors, space } from "@/theme";

const TREND_ICON = { up: "trending-up", down: "trending-down", flat: "remove" } as const;
const TREND_COLOR = { up: colors.success, down: colors.danger, flat: colors.muted };

/** 한 과정의 교사 보드: 요약 + 교육생 카드 목록 */
export function TeacherBoard({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const course = courseById(courseId);
  const students = STUDENTS.filter((s) => s.courseId === courseId);
  const avg = students.length
    ? Math.round(students.reduce((sum, s) => sum + s.lastScore, 0) / students.length)
    : 0;

  return (
    <View style={{ gap: space.md }}>
      <View style={styles.summary}>
        <Stat label={t("teacher_students")} value={String(students.length)} />
        <Stat label={t("teacher_avgScore")} value={String(avg)} />
        <Stat label={t("staff_weeklySubmissions")} value={String(course?.weeklySubmissions ?? 0)} />
      </View>
      {students.map((s) => (
        <StudentCard key={s.id} student={s} />
      ))}
    </View>
  );
}

function StudentCard({ student: s }: { student: Student }) {
  const { t } = useTranslation();
  return (
    <Card>
      <View style={styles.cardTop}>
        <Text style={styles.name}>{s.name}</Text>
        <Ionicons name={TREND_ICON[s.trend]} size={20} color={TREND_COLOR[s.trend]} />
        <View style={{ flex: 1 }} />
        <ScoreBadge score={s.lastScore} />
      </View>
      <Text style={styles.meta}>
        {t("teacher_submissions", { count: s.submissions })} · {t("teacher_frequentDefect")}:{" "}
        {t(`defect_${s.frequentDefect}`)}
      </Text>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", gap: space.sm },
  stat: { flex: 1, alignItems: "center", padding: space.md },
  statValue: { color: colors.primary, fontSize: 22, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 12, textAlign: "center" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { color: colors.text, fontWeight: "700", fontSize: 16 },
  meta: { color: colors.muted, fontSize: 13 },
});
