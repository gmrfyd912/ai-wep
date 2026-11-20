import { router } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Card, ImagePlaceholder, PreviewNotice, Screen, ScoreBadge } from "@/components/ui";
import { courseById, RESULTS, studentById } from "@/mock/data";
import { CourseFilter } from "@/screens/CourseFilter";
import { colors, space } from "@/theme";

export function GalleryScreen() {
  useTranslation();
  const [course, setCourse] = useState("all");
  const items = RESULTS.filter((r) => course === "all" || studentById(r.studentId)?.courseId === course);

  return (
    <Screen>
      <CourseFilter value={course} onChange={setCourse} />
      <View style={styles.grid}>
        {items.map((r) => {
          const s = studentById(r.studentId);
          return (
            <Card key={r.id} style={styles.item} onPress={() => router.push(`/result/${r.id}`)}>
              <ImagePlaceholder height={100} />
              <Text style={styles.name} numberOfLines={1}>{s?.name}</Text>
              <Text style={styles.course}>{s ? courseById(s.courseId)?.name : ""}</Text>
              <ScoreBadge score={r.score} />
            </Card>
          );
        })}
      </View>
      <PreviewNotice />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  item: { width: "47%", padding: space.md, alignItems: "flex-start" },
  name: { color: colors.text, fontWeight: "700", fontSize: 15 },
  course: { color: colors.muted, fontSize: 12 },
});
