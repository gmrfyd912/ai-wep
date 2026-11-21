import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Field, Screen } from "@/components/ui";
import { authErrorKey, deleteAccount } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors } from "@/theme";

/** 계정 영구 삭제 (스토어 필수 기능): 비밀번호 확인 → 한 번 더 묻고 → 사진·기록까지 삭제 */
export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  const { signOut } = useSession();
  const [pw, setPw] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const doDelete = async () => {
    setError("");
    setBusy(true);
    try {
      await deleteAccount(pw);
      await signOut();
      if (router.canDismiss()) router.dismissAll();
      router.replace("/login");
    } catch (e) {
      const { key, values } = authErrorKey(e);
      setError(t(key as "error_network", values));
    } finally {
      setBusy(false);
    }
  };

  const confirm = () => {
    if (!pw) return setError(t("login_errorRequired"));
    Alert.alert(t("delete_confirmTitle"), t("delete_confirmMessage"), [
      { text: t("common_cancel"), style: "cancel" },
      { text: t("delete_button"), style: "destructive", onPress: doDelete },
    ]);
  };

  return (
    <Screen>
      <Card style={{ borderColor: colors.danger }}>
        <Ionicons name="warning-outline" size={28} color={colors.danger} />
        <Body>{t("delete_warning")}</Body>
      </Card>
      <Field label={t("delete_password")} value={pw} onChangeText={setPw} secureTextEntry />
      {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      <AppButton label={busy ? t("auth_working") : t("delete_button")} variant="danger" onPress={confirm} disabled={busy} />
    </Screen>
  );
}
