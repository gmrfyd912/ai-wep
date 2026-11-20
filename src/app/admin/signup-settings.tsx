import { useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Body, Card, Screen } from "@/components/ui";
import { colors, space } from "@/theme";

export default function SignupSettings() {
  const { t } = useTranslation();
  // 기본값: 둘 다 꺼짐(가입 즉시 사용)
  const [students, setStudents] = useState(false);
  const [staff, setStaff] = useState(false);

  return (
    <Screen>
      <Body muted>{t("admin_localOnly")}</Body>
      <Card>
        <Row label={t("admin_approveStudents")} value={students} onChange={setStudents} />
        <Row label={t("admin_approveStaff")} value={staff} onChange={setStaff} />
      </Card>
      <Body muted>{t("admin_approveHint")}</Body>
    </Screen>
  );
}

function Row({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingVertical: 6 },
  label: { color: colors.text, fontSize: 15, flex: 1 },
});
