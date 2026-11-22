import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { ProfilePhotoPicker, type PickedPhoto } from "@/components/ProfilePhoto";
import { AppButton, Body, Chips, Field, Label, Screen } from "@/components/ui";
import { goAfterLogin } from "@/lib/afterLogin";
import { authErrorKey, getSignupPhotoRule, listCourses, signup, type Course } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors, radius, space } from "@/theme";

type SignupRole = "student" | "teacher" | "staff";

export default function SignupScreen() {
  const { t } = useTranslation();
  const { signIn } = useSession();
  const [role, setRole] = useState<SignupRole>("student");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [email, setEmail] = useState("");
  const [course, setCourse] = useState<string | null>(null);
  const [teacherCourses, setTeacherCourses] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [coursesFailed, setCoursesFailed] = useState(false);
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [photoRequired, setPhotoRequired] = useState(true); // 기본은 필수 (시스템관리자가 바꿀 수 있음)

  // 과정 목록은 서버에서 (시스템관리자가 만든 운영 중인 과정)
  const loadCourses = useCallback(() => {
    setCoursesFailed(false);
    listCourses()
      .then(setCourses)
      .catch(() => setCoursesFailed(true));
  }, []);
  useEffect(loadCourses, [loadCourses]);
  useEffect(() => {
    getSignupPhotoRule()
      .then((r) => setPhotoRequired(r.avatar_required))
      .catch(() => null);
  }, []);
  const activeCourses = courses ?? [];

  const toggleTeacherCourse = (cid: string) =>
    setTeacherCourses((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));

  const submit = async () => {
    if (!name.trim() || !id.trim() || !pw) return setError(t("signup_errorRequired"));
    if (pw !== pw2) return setError(t("signup_errorPasswordMatch"));
    if (role === "student" && !course) return setError(t("signup_errorCourse"));
    if (role === "teacher" && teacherCourses.length === 0) return setError(t("signup_errorTeacherCourse"));
    if (photoRequired && !photo) return setError(t("auth_err_avatar_required"));
    setError("");
    setBusy(true);
    try {
      const course_ids = role === "student" ? [course!] : role === "teacher" ? teacherCourses : [];
      const r = await signup({ login_id: id, password: pw, name, role, email: email.trim() || null,
        course_ids,
        avatar_b64: photo?.base64 || null,
      });
      if ("pending" in r) {
        router.replace("/pending");
        return;
      }
      await signIn(r.token, r.user);
      goAfterLogin(r.user, t);
    } catch (e) {
      const { key, values } = authErrorKey(e);
      setError(t(key as "error_network", values));
    } finally {
      setBusy(false);
    }
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

      <Label>{photoRequired ? t("avatar_label") : t("avatar_labelOptional")}</Label>
      <ProfilePhotoPicker url={photo?.uri} name={name} busy={busy} onPick={setPhoto} onDenied={() => setError(t("upload_permissionDenied"))} />
      <Text style={styles.hint}>{t("avatar_hint")}</Text>

      <Field label={t("signup_name")} value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label={t("login_id")} value={id} onChangeText={setId} />
      <Field label={t("login_password")} value={pw} onChangeText={setPw} secureTextEntry />
      <Field label={t("signup_passwordConfirm")} value={pw2} onChangeText={setPw2} secureTextEntry />
      <Field label={t("signup_email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCorrect={false} />
      <Text style={styles.hint}>{t("signup_emailHint")}</Text>

      {courses == null && role !== "staff" ? (
        coursesFailed ? (
          <Pressable onPress={loadCourses}>
            <Text style={styles.error}>{t("signup_coursesFailed")}</Text>
          </Pressable>
        ) : (
          <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
            <ActivityIndicator color={colors.primary} />
            <Body muted>{t("auth_waking")}</Body>
          </View>
        )
      ) : null}

      {role === "student" && courses ? (
        <View style={{ gap: space.xs }}>
          <Label>{t("signup_course")}</Label>
          <Pressable style={styles.dropdown} onPress={() => setOpen((o) => !o)}>
            <Text style={[styles.dropdownText, !course && { color: colors.faint }]}>
              {course ? activeCourses.find((c) => c.id === course)?.name : t("signup_coursePlaceholder")}
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

      {role === "teacher" && courses ? (
        <View style={{ gap: space.xs }}>
          <Label>{t("signup_teacherCourses")}</Label>
          <Chips
            options={activeCourses.map((c) => ({ value: c.id, label: c.name }))}
            value={teacherCourses}
            onChange={toggleTeacherCourse}
          />
        </View>
      ) : null}

      <Text style={styles.hint}>{t("signup_publicNote")}</Text>
      <Text style={styles.hint}>{t("privacy_aiTraining")}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label={busy ? t("auth_working") : t("signup_submit")} onPress={submit} disabled={busy} />
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
  hint: { color: colors.muted, fontSize: 13, marginTop: -space.xs },
});
