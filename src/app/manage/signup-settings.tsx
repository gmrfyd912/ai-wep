import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Body, Card, Screen } from "@/components/ui";
import { authErrorKey, getSignupRules, saveSignupRules, type SignupRules } from "@/lib/api";
import { colors, space } from "@/theme";

/** 가입 방식 설정: 켜면 그 역할은 가입 후 승인을 받아야 사용 (기본은 둘 다 꺼짐) */
export default function SignupSettings() {
  const { t } = useTranslation();
  const [rules, setRules] = useState<SignupRules | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getSignupRules()
      .then(setRules)
      .catch((e) => setError(t(authErrorKey(e).key as "error_network")));
  }, [t]);

  const change = async (next: SignupRules) => {
    const before = rules;
    setRules(next); // 바로 바꿔 보여 주고, 실패하면 되돌린다
    setError("");
    try {
      setRules(await saveSignupRules(next));
    } catch (e) {
      setRules(before);
      setError(t(authErrorKey(e).key as "error_network"));
    }
  };

  return (
    <Screen>
      {!rules && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {rules ? (
        <Card>
          <Row label={t("admin_approveStudents")} value={rules.student_approval} onChange={(v) => change({ ...rules, student_approval: v })} />
          <Row label={t("admin_approveStaff")} value={rules.staff_approval} onChange={(v) => change({ ...rules, staff_approval: v })} />
        </Card>
      ) : null}
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <Body muted>{t("admin_approveHint")}</Body>
      <Body muted>{t("manage_approveWho")}</Body>
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
