import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, Field, Screen, SectionTitle } from "@/components/ui";
import {
  authErrorKey,
  listManagedCourses,
  listMembers,
  setCourseTeachers,
  updateCourse,
  type CourseRole,
  type ManagedCourse,
  type Member,
} from "@/lib/api";
import { colors, space } from "@/theme";

type Pick = CourseRole | "none";

/** 과정 설정: 이름 바꾸기, 종료/다시 열기, 담임(1명)·부담임(여러 명) 정하기 */
export default function ManageCourse() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [course, setCourse] = useState<ManagedCourse | null>(null);
  const [teachers, setTeachers] = useState<Member[]>([]);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([listManagedCourses(), listMembers()])
      .then(([cs, ms]) => {
        const c = cs.find((x) => x.id === id) ?? null;
        setCourse(c);
        setName(c?.name ?? "");
        setTeachers(ms.filter((m) => m.role === "teacher" && m.status !== "disabled"));
        const p: Record<string, Pick> = {};
        for (const tch of c?.teachers ?? []) p[tch.id] = tch.course_role ?? "assistant";
        setPicks(p);
      })
      .catch((e) => setMsg({ ok: false, text: t(authErrorKey(e).key as "error_network") }));
  }, [id, t]);

  if (!course) {
    return (
      <Screen>
        {msg ? <Text style={styles.error}>{msg.text}</Text> : <ActivityIndicator color={colors.primary} />}
      </Screen>
    );
  }

  const run = async (fn: () => Promise<void>) => {
    setMsg(null);
    setBusy(true);
    try {
      await fn();
      setMsg({ ok: true, text: t("profile_saved") });
    } catch (e) {
      setMsg({ ok: false, text: t(authErrorKey(e).key as "error_network") });
    } finally {
      setBusy(false);
    }
  };

  const saveName = () =>
    run(async () => {
      const c = await updateCourse(course.id, { name: name.trim() });
      setCourse({ ...course, name: c.name });
    });

  const toggleActive = () => {
    const doIt = () =>
      run(async () => {
        const c = await updateCourse(course.id, { active: !course.active });
        setCourse({ ...course, active: c.active });
      });
    if (course.active) {
      Alert.alert(t("admin_courseEnd"), t("manage_endConfirm", { name: course.name }), [
        { text: t("common_cancel"), style: "cancel" },
        { text: t("admin_courseEnd"), style: "destructive", onPress: doIt },
      ]);
    } else doIt();
  };

  const setPick = (uid: string, v: Pick) =>
    setPicks((prev) => {
      const next = { ...prev };
      if (v === "homeroom") {
        // 담임은 한 명: 다른 담임은 부담임으로
        for (const k of Object.keys(next)) if (next[k] === "homeroom") next[k] = "assistant";
      }
      next[uid] = v;
      return next;
    });

  const saveTeachers = () =>
    run(async () => {
      const list = Object.entries(picks)
        .filter(([, v]) => v !== "none")
        .map(([user_id, v]) => ({ user_id, course_role: v as CourseRole }));
      await setCourseTeachers(course.id, list);
    });

  // 이미 이 과정을 맡은 교사를 위에
  const sorted = [...teachers].sort(
    (a, b) => Number((picks[b.id] ?? "none") !== "none") - Number((picks[a.id] ?? "none") !== "none") || a.name.localeCompare(b.name),
  );

  return (
    <Screen>
      <Field label={t("manage_courseName")} value={name} onChangeText={setName} onSubmitEditing={saveName} />
      <AppButton label={t("common_save")} onPress={saveName} disabled={busy || !name.trim() || name.trim() === course.name} />
      <AppButton
        label={course.active ? t("admin_courseEnd") : t("admin_courseReopen")}
        variant={course.active ? "danger" : "secondary"}
        onPress={toggleActive}
        disabled={busy}
      />
      <Body muted>{t("manage_endHint")}</Body>

      <SectionTitle>{t("manage_teachers")}</SectionTitle>
      <Body muted>{t("manage_teachersHint")}</Body>
      {sorted.length === 0 ? <Body muted>{t("manage_noTeachers")}</Body> : null}
      {sorted.map((m) => (
        <Card key={m.id}>
          <View style={styles.top}>
            <Text style={styles.name}>{m.name}</Text>
            <Text style={styles.meta}>{m.login_id}</Text>
          </View>
          <Chips<Pick>
            options={[
              { value: "none", label: t("course_none") },
              { value: "homeroom", label: t("course_homeroom") },
              { value: "assistant", label: t("course_assistant") },
            ]}
            value={picks[m.id] ?? "none"}
            onChange={(v) => setPick(m.id, v)}
          />
        </Card>
      ))}
      {sorted.length ? <AppButton label={t("common_save")} onPress={saveTeachers} disabled={busy} /> : null}
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger }}>{msg.text}</Text> : null}
      <AppButton label={t("common_back")} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger },
});
