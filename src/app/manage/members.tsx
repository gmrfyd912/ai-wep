import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Body, Card, Chips, Field, Screen } from "@/components/ui";
import { authErrorKey, canManage, listMembers, type Member } from "@/lib/api";
import { StatusBadge } from "@/screens/MemberActions";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

type Filter = "all" | "pending" | Member["role"];

/** 회원 관리: 역할·승인 대기로 거르고 이름·아이디로 찾기. 누르면 회원 상세 */
export default function ManageMembers() {
  const { t } = useTranslation();
  const { user } = useSession();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    listMembers()
      .then(setMembers)
      .catch((e) => setError(t(authErrorKey(e).key as "error_network")));
  }, [t]);
  useFocusEffect(load);

  if (!canManage(user, "manage_members")) {
    return (
      <Screen>
        <Body muted>{t("manage_forbidden")}</Body>
      </Screen>
    );
  }

  const pendingCount = members?.filter((m) => m.status === "pending").length ?? 0;
  const query = q.trim().toLowerCase();
  const shown = (members ?? []).filter(
    (m) =>
      (filter === "all" || (filter === "pending" ? m.status === "pending" : m.role === filter)) &&
      (!query || m.name.toLowerCase().includes(query) || m.login_id.toLowerCase().includes(query)),
  );

  return (
    <Screen>
      <Chips<Filter>
        options={[
          { value: "all", label: t("common_all") },
          { value: "pending", label: `${t("admin_memberPending")}${pendingCount ? ` ${pendingCount}` : ""}` },
          { value: "student", label: t("role_student") },
          { value: "teacher", label: t("role_teacher") },
          { value: "staff", label: t("role_staff") },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <Field label={t("manage_search")} value={q} onChangeText={setQ} autoCorrect={false} returnKeyType="search" onSubmitEditing={() => null} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!members && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {members && shown.length === 0 ? <Body muted>{t("manage_noMembers")}</Body> : null}
      {shown.map((m) => (
        <Card key={m.id} onPress={() => router.push({ pathname: "/manage/member/[id]", params: { id: m.id } })} style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {m.name} <Text style={styles.meta}>{m.login_id}</Text>
            </Text>
            <Text style={styles.meta}>
              {t(`role_${m.role}`)}
              {m.courses.length ? ` · ${m.courses.map((c) => c.name).join(", ")}` : ""}
            </Text>
          </View>
          <StatusBadge status={m.status} />
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13, fontWeight: "400" },
  error: { color: colors.danger },
});
