import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, Label, Screen, SectionTitle } from "@/components/ui";
import {
  authErrorKey,
  canManage,
  getMember,
  listManagedCourses,
  updateMember,
  type ManagedCourse,
  type Member,
} from "@/lib/api";
import { useSession } from "@/state/session";
import { MemberActions, StatusBadge } from "@/screens/MemberActions";
import { colors, space } from "@/theme";

type EditRole = Member["role"];

/** 회원 상세: 승인·비밀번호 초기화·사용 중지, 역할·과정(반 이동), 행정 관리자 추가 권한 */
export default function ManageMember() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const [m, setM] = useState<Member | null>(null);
  const [courses, setCourses] = useState<ManagedCourse[]>([]);
  const [role, setRole] = useState<EditRole>("student");
  const [courseIds, setCourseIds] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((x: Member) => {
    setM(x);
    setRole(x.role);
    setCourseIds(x.courses.map((c) => c.id));
  }, []);

  const load = useCallback(() => {
    getMember(id)
      .then(apply)
      .catch((e) => setMsg({ ok: false, text: t(authErrorKey(e).key as "error_network") }));
  }, [id, apply, t]);

  useEffect(() => {
    load();
    listManagedCourses()
      .then(setCourses)
      .catch(() => null);
  }, [load]);

  if (!m) {
    return (
      <Screen>
        {msg ? <Text style={styles.error}>{msg.text}</Text> : <ActivityIndicator color={colors.primary} />}
      </Screen>
    );
  }

  const isAdmin = user?.role === "admin";
  const canEdit = canManage(user, "manage_members") && user?.id !== m.id;

  const run = async (fn: () => Promise<Member>) => {
    setMsg(null);
    setBusy(true);
    try {
      apply(await fn());
      setMsg({ ok: true, text: t("profile_saved") });
    } catch (e) {
      setMsg({ ok: false, text: t(authErrorKey(e).key as "error_network") });
    } finally {
      setBusy(false);
    }
  };

  const toggleCourse = (cid: string) => {
    if (role === "student") setCourseIds([cid]);
    else setCourseIds((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid]));
  };

  const saveRoleCourses = () => run(() => updateMember(m.id, { role, course_ids: role === "staff" ? [] : courseIds }));
  const setStatus = (status: "active" | "disabled") => run(() => updateMember(m.id, { status }));
  const setPerm = (k: keyof Member["permissions"], v: boolean) =>
    run(() => updateMember(m.id, { permissions: { ...m.permissions, [k]: v } }));

  // 종료된 과정은 지금 들어 있는 경우만 보여 준다
  const courseOptions = courses.filter((c) => c.active || courseIds.includes(c.id));
  const lastLogin = m.last_login_at ? new Date(m.last_login_at).toLocaleString(i18n.language) : null;

  return (
    <Screen>
      <Card>
        <View style={styles.top}>
          <Text style={styles.name}>{m.name}</Text>
          <Text style={styles.meta}>{m.login_id}</Text>
          <View style={{ flex: 1 }} />
          <StatusBadge status={m.status} />
        </View>
        <Text style={styles.meta}>
          {t(`role_${m.role}`)}
          {m.courses.length
            ? ` · ${m.courses
                .map((c) => (c.course_role ? `${c.name}(${t(`course_${c.course_role}`)})` : c.name))
                .join(", ")}`
            : ""}
        </Text>
        {m.email ? <Text style={styles.meta}>{m.email}</Text> : null}
        <Text style={styles.meta}>{lastLogin ? t("manage_lastLogin", { date: lastLogin }) : t("manage_never")}</Text>
      </Card>

      <MemberActions member={m} onChanged={load} />

      {canEdit ? (
        <>
          <SectionTitle>{t("manage_edit")}</SectionTitle>
          <Label>{t("manage_role")}</Label>
          <Chips<EditRole>
            options={[
              { value: "student", label: t("role_student") },
              { value: "teacher", label: t("role_teacher") },
              { value: "staff", label: t("role_staff") },
            ]}
            value={role}
            onChange={(r) => {
              setRole(r);
              if (r === "student") setCourseIds((prev) => prev.slice(0, 1));
            }}
          />
          {role !== "staff" ? (
            <>
              <Label>{role === "student" ? t("signup_course") : t("signup_teacherCourses")}</Label>
              <Chips
                options={courseOptions.map((c) => ({ value: c.id, label: c.name }))}
                value={courseIds}
                onChange={toggleCourse}
              />
            </>
          ) : null}
          <AppButton label={t("common_save")} onPress={saveRoleCourses} disabled={busy} />

          {m.role === "staff" && isAdmin ? (
            <>
              <SectionTitle>{t("manage_permissions")}</SectionTitle>
              <Body muted>{t("manage_permissionsHint")}</Body>
              <Card>
                <PermRow label={t("admin_permManageCourses")} value={m.permissions.manage_courses} onChange={(v) => setPerm("manage_courses", v)} />
                <PermRow label={t("admin_permManageMembers")} value={m.permissions.manage_members} onChange={(v) => setPerm("manage_members", v)} />
              </Card>
            </>
          ) : null}

          {m.status === "graduated" ? <Body muted>{t("manage_statusGraduatedInfo")}</Body> : null}
          {m.status === "disabled" || m.status === "graduated" ? (
            <AppButton label={t("manage_enable")} variant="secondary" onPress={() => setStatus("active")} disabled={busy} />
          ) : m.status === "active" ? (
            <AppButton label={t("manage_disable")} variant="danger" onPress={() => setStatus("disabled")} disabled={busy} />
          ) : null}
        </>
      ) : null}

      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger }}>{msg.text}</Text> : null}
      {m.role === "student" ? (
        <AppButton
          label={t("student_records")}
          icon="document-text-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: "/student-view/[id]", params: { id: m.id } })}
        />
      ) : null}
    </Screen>
  );
}

function PermRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.permRow}>
      <Text style={styles.permLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { color: colors.text, fontSize: 18, fontWeight: "800" },
  meta: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger },
  permRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 6 },
  permLabel: { color: colors.text, fontSize: 15, flex: 1 },
});
