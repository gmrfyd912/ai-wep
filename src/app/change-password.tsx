import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Field, Screen } from "@/components/ui";
import { goAfterLogin } from "@/lib/afterLogin";
import { authErrorKey, changePassword } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors } from "@/theme";

/** 비밀번호 변경. forced=1 이면 첫 로그인·초기화 직후라 지금 비밀번호를 묻지 않고, 바꾸면 내 화면으로 간다. */
export default function ChangePasswordScreen() {
  const { t } = useTranslation();
  const { forced } = useLocalSearchParams<{ forced?: string }>();
  const { user, setUser } = useSession();
  const mustChange = !!user?.must_change_password;
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const save = async () => {
    if (pw !== pw2) return setError(t("signup_errorPasswordMatch"));
    setError("");
    setBusy(true);
    try {
      const me = await changePassword(current, pw);
      setUser(me);
      if (forced || mustChange) {
        goAfterLogin(me, t);
      } else {
        Alert.alert(t("pw_title"), t("pw_done"));
        router.back();
      }
    } catch (e) {
      const { key, values } = authErrorKey(e);
      setError(t(key as "error_network", values));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {mustChange ? (
        <Card style={{ borderColor: colors.warning }}>
          <Body>{t("pw_forcedDesc")}</Body>
        </Card>
      ) : (
        <Field label={t("pw_current")} value={current} onChangeText={setCurrent} secureTextEntry />
      )}
      <Field label={t("pw_new")} value={pw} onChangeText={setPw} secureTextEntry />
      <Field label={t("pw_confirm")} value={pw2} onChangeText={setPw2} secureTextEntry />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label={busy ? t("auth_working") : t("pw_save")} onPress={save} disabled={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger, fontSize: 14 },
});
