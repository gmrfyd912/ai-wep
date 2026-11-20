import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Chips, Field, Label, Screen } from "@/components/ui";
import { COURSES } from "@/mock/data";
import { colors, radius, space } from "@/theme";

type SignupRole = "student" | "teacher" | "staff";

export default function SignupScreen() {
  const { t } = useTranslation();
  const [role, setRole] = useState<SignupRole>("student");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [course, setCourse] = useState<string | null>(null);
  const [teacherCourses, setTeacherCourses] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const activeCourses = COURSES.filter((c) => c.active);

  const toggleTeacherCourse = (cid: string) =>
    setTeacherCourses((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));

  const submit = () => {
    if (!name.trim() || !id.trim() || !pw) return setError(t("signup_errorRequired"));
    if (pw !== pw2) return setError(t("signup_errorPasswordMatch"));
    if (role === "student" && !course) return setError(t("signup_errorCourse"));
    setError("");
    // 실제 가입 처리는 6단계에서 연결. 지금은 승인 대기 화면만 보여준다.
    router.replace("/pending");
  };

  return (
    <Screen>
      <Label>{t("signup_roleLabel")}</Label>
      <Chips<SignupRole>
        options={[
          { value: "student", label: t("role_student") },
          { value: "teacher", label: t("role_teacher") },
          { value: "staff", label: t("role_staff") },
        ]}
        value={role}
        onChange={setRole}
      />

      <Field label={t("signup_name")} value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label={t("login_id")} value={id} onChangeText={setId} />
      <Field label={t("login_password")} value={pw} onChangeText={setPw} secureTextEntry />
      <Field label={t("signup_passwordConfirm")} value={pw2} onChangeText={setPw2} secureTextEntry />

      {role === "student" ? (
        <View style={{ gap: space.xs }}>
          <Label>{t("signup_course")}</Label>
          <Pressable style={styles.dropdown} onPress={() => setOpen((o) => !o)}>
            <Text style={[styles.dropdownText, !course && { color: colors.faint }]}>
              {course ? COURSES.find((c) => c.id === course)?.name : t("signup_coursePlaceholder")}
            </Text>
            <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={colors.muted} />
          </Pressable>
          {open ? (
            <View style={styles.dropdownList}>
              {activeCourses.map((c) => (
                <Pressable
                  key={c.id}
                  style={styles.dropdownItem}
                  onPress={() => {
                    setCourse(c.id);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.dropdownText, course === c.id && { color: colors.primary }]}>{c.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {role === "teacher" ? (
        <View style={{ gap: space.xs }}>
          <Label>{t("signup_teacherCourses")}</Label>
          <Chips
            options={activeCourses.map((c) => ({ value: c.id, label: c.name }))}
            value={teacherCourses}
            onChange={toggleTeacherCourse}
          />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label={t("signup_submit")} onPress={submit} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 14,
  },
  dropdownText: { color: colors.text, fontSize: 16 },
  dropdownList: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  dropdownItem: { paddingHorizontal: space.md, paddingVertical: 14, borderBottomColor: colors.border, borderBottomWidth: 1 },
  error: { color: colors.danger, fontSize: 14 },
});
