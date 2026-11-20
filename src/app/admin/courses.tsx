import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Field, Screen } from "@/components/ui";
import { COURSES, type Course } from "@/mock/data";
import { colors, space } from "@/theme";

export default function AdminCourses() {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<Course[]>(COURSES);
  const [name, setName] = useState("");

  const add = () => {
    if (!name.trim()) return;
    setCourses((prev) => [
      ...prev,
      { id: `new-${Date.now()}`, name: name.trim(), homeroom: "-", active: true, weeklySubmissions: 0 },
    ]);
    setName("");
  };
  const toggle = (id: string) =>
    setCourses((prev) => prev.map((c) => (c.id === id ? { ...c, active: !c.active } : c)));

  return (
    <Screen>
      <Body muted>{t("admin_localOnly")}</Body>
      <View style={styles.addRow}>
        <View style={{ flex: 1 }}>
          <Field label={t("admin_courseNew")} value={name} onChangeText={setName} autoCapitalize="none" />
        </View>
        <AppButton label={t("admin_courseAdd")} onPress={add} />
      </View>
      {courses.map((c) => (
        <Card key={c.id} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{c.name}</Text>
            <Text style={[styles.status, { color: c.active ? colors.success : colors.faint }]}>
              {c.active ? t("admin_courseActive") : t("admin_courseEnded")}
            </Text>
          </View>
          <AppButton
            label={c.active ? t("admin_courseEnd") : t("admin_courseReopen")}
            variant="secondary"
            onPress={() => toggle(c.id)}
          />
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  addRow: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  status: { fontSize: 13, marginTop: 2 },
});
