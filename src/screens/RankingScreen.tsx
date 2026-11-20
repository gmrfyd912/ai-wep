import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Body, Card, PreviewNotice, Screen, ScoreBadge } from "@/components/ui";
import { courseById, STUDENTS } from "@/mock/data";
import { CourseFilter } from "@/screens/CourseFilter";
import { colors, space } from "@/theme";

export function RankingScreen() {
  const { t } = useTranslation();
  const [course, setCourse] = useState("all");
  const ranked = STUDENTS.filter((s) => course === "all" || s.courseId === course).sort(
    (a, b) => b.lastScore - a.lastScore,
  );

  return (
    <Screen>
      <CourseFilter value={course} onChange={setCourse} />
      <Body muted>{t("ranking_basis")}</Body>
      {ranked.map((s, i) => (
        <Card key={s.id} style={styles.row}>
          <Text style={[styles.rank, i < 3 && { color: colors.primary }]}>
            {t("ranking_rank", { rank: i + 1 })}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{s.name}</Text>
            <Text style={styles.course}>{courseById(s.courseId)?.name}</Text>
          </View>
          <ScoreBadge score={s.lastScore} />
        </Card>
      ))}
      <PreviewNotice />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  rank: { color: colors.muted, fontWeight: "800", fontSize: 15, minWidth: 56 },
  name: { color: colors.text, fontWeight: "700", fontSize: 15 },
  course: { color: colors.muted, fontSize: 12 },
});
