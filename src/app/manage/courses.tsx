import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Field, Screen } from "@/components/ui";
import { addCourse, authErrorKey, canManage, listManagedCourses, type ManagedCourse } from "@/lib/api";
import { useSession } from "@/state/session";
import { TeacherLine } from "@/screens/TeacherBoard";
import { colors, space } from "@/theme";

/** 과정 관리: 과정 추가, 목록(운영 중·종료), 누르면 이름·담임·부담임·종료 설정 */
export default function ManageCourses() {
  const { t } = useTranslation();
  const { user } = useSession();
  const [courses, setCourses] = useState<ManagedCourse[] | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listManagedCourses()
      .then(setCourses)
      .catch((e) => setError(t(authErrorKey(e).key as "error_network")));
  }, [t]);
  useFocusEffect(load);

  if (!canManage(user, "manage_courses")) {
    return (
      <Screen>
        <Body muted>{t("manage_forbidden")}</Body>
      </Screen>
    );
  }

  const add = async () => {
    if (!name.trim()) return;
    setError("");
    setBusy(true);
    try {
      await addCourse(name.trim());
      setName("");
      load();
    } catch (e) {
      setError(t(authErrorKey(e).key as "error_network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Field label={t("admin_courseNew")} value={name} onChangeText={setName} onSubmitEditing={add} />
      <AppButton label={t("admin_courseAdd")} onPress={add} disabled={busy || !name.trim()} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!courses ? <ActivityIndicator color={colors.primary} /> : null}
      {courses?.map((c) => (
        <Card
          key={c.id}
          onPress={() => router.push({ pathname: "/manage/course/[id]", params: { id: c.id } })}
          style={c.active ? undefined : { opacity: 0.6 }}
        >
          <View style={styles.top}>
            <Text style={styles.name}>{c.name}</Text>
            <Text style={[styles.badge, { color: c.active ? colors.success : colors.muted }]}>
              {c.active ? t("admin_courseActive") : t("admin_courseEnded")}
            </Text>
            <View style={{ flex: 1 }} />
            <Text style={styles.meta}>{t("manage_studentCount", { count: c.student_count })}</Text>
          </View>
          <TeacherLine teachers={c.teachers} />
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { color: colors.text, fontSize: 17, fontWeight: "700" },
  badge: { fontSize: 12, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger },
});
