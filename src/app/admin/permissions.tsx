import { useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Body, Card, Screen, SectionTitle } from "@/components/ui";
import type { TranslationKey } from "@/i18n/locales/ko";
import { colors, space } from "@/theme";

type PermRole = "staff" | "teacher" | "student";
type Perm = "viewAllCourses" | "viewOthersResults" | "manageCourses" | "manageMembers";

const PERMS: { key: Perm; label: TranslationKey }[] = [
  { key: "viewAllCourses", label: "admin_permViewAllCourses" },
  { key: "viewOthersResults", label: "admin_permViewOthersResults" },
  { key: "manageCourses", label: "admin_permManageCourses" },
  { key: "manageMembers", label: "admin_permManageMembers" },
];

// 기본 권한: 행정 관리자는 모든 과정 보기, 모두가 다른 교육생 결과 보기(갤러리·랭킹 공유)
const DEFAULTS: Record<PermRole, Record<Perm, boolean>> = {
  staff: { viewAllCourses: true, viewOthersResults: true, manageCourses: false, manageMembers: false },
  teacher: { viewAllCourses: false, viewOthersResults: true, manageCourses: false, manageMembers: false },
  student: { viewAllCourses: false, viewOthersResults: true, manageCourses: false, manageMembers: false },
};

export default function AdminPermissions() {
  const { t } = useTranslation();
  const [perms, setPerms] = useState(DEFAULTS);

  const toggle = (role: PermRole, key: Perm) =>
    setPerms((prev) => ({ ...prev, [role]: { ...prev[role], [key]: !prev[role][key] } }));

  return (
    <Screen>
      <Body muted>{t("admin_localOnly")}</Body>
      {(["staff", "teacher", "student"] as const).map((role) => (
        <Card key={role}>
          <SectionTitle>{t(`role_${role}`)}</SectionTitle>
          {PERMS.map((p) => (
            <View key={p.key} style={styles.row}>
              <Text style={styles.label}>{t(p.label)}</Text>
              <Switch
                value={perms[role][p.key]}
                onValueChange={() => toggle(role, p.key)}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          ))}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingVertical: 4 },
  label: { color: colors.text, fontSize: 15, flex: 1 },
});
