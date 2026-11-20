import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, Screen } from "@/components/ui";
import type { Role } from "@/state/session";
import { colors, space } from "@/theme";

type Member = { id: string; name: string; role: Exclude<Role, "admin">; approved: boolean };

const INITIAL: Member[] = [
  { id: "m1", name: "김민수", role: "student", approved: true },
  { id: "m2", name: "Carlos Quispe", role: "student", approved: false },
  { id: "m3", name: "김교사", role: "teacher", approved: true },
  { id: "m4", name: "최교사", role: "teacher", approved: false },
  { id: "m5", name: "한행정", role: "staff", approved: true },
];

export default function AdminMembers() {
  const { t } = useTranslation();
  const [members, setMembers] = useState(INITIAL);
  const [filter, setFilter] = useState<"all" | Member["role"]>("all");

  const approve = (id: string) =>
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, approved: true } : m)));

  return (
    <Screen>
      <Body muted>{t("admin_localOnly")}</Body>
      <Chips<"all" | Member["role"]>
        options={[
          { value: "all", label: t("common_all") },
          { value: "student", label: t("role_student") },
          { value: "teacher", label: t("role_teacher") },
          { value: "staff", label: t("role_staff") },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {members
        .filter((m) => filter === "all" || m.role === filter)
        .map((m) => (
          <Card key={m.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{m.name}</Text>
              <Text style={styles.meta}>{t(`role_${m.role}`)}</Text>
            </View>
            {m.approved ? (
              <Text style={[styles.meta, { color: colors.success }]}>{t("admin_memberApproved")}</Text>
            ) : (
              <AppButton label={t("admin_memberApprove")} onPress={() => approve(m.id)} />
            )}
          </Card>
        ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  name: { color: colors.text, fontSize: 16, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
});
