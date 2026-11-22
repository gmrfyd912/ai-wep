import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Field, Screen } from "@/components/ui";
import { LANGUAGES } from "@/i18n";
import { goAfterLogin } from "@/lib/afterLogin";
import { authErrorKey, login } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

export default function LoginScreen() {
  const { t, i18n } = useTranslation();
  const { signIn, notice, lastLoginId } = useSession();
  const [id, setId] = useState(lastLoginId);
  // 저장된 아이디가 늦게 읽히면 비어 있을 때만 채운다
  useEffect(() => {
    if (lastLoginId) setId((cur) => cur || lastLoginId);
  }, [lastLoginId]);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const langName = LANGUAGES.find((l) => l.code === i18n.language)?.nativeName ?? "";

  const submit = async () => {
    if (!id.trim() || !pw) return setError(t("login_errorRequired"));
    setError("");
    setBusy(true);
    try {
      const r = await login(id, pw);
      await signIn(r.token, r.user);
      goAfterLogin(r.user, t);
    } catch (e) {
      const { key, values } = authErrorKey(e);
      if (key === "auth_err_pending") router.replace("/pending");
      else setError(t(key as "error_network", values));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen safeTop>
      <Pressable style={styles.lang} onPress={() => router.push("/language")}>
        <Ionicons name="globe-outline" size={18} color={colors.muted} />
        <Text style={styles.langText}>{langName}</Text>
      </Pressable>

      <View style={styles.brand}>
        <Text style={styles.logo}>AI W.E.P</Text>
        <Text style={styles.sub}>{t("common_appSubtitle")}</Text>
      </View>

      {notice ? (
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.noticeText}>{t(notice === "updated" ? "login_reloginUpdated" : "login_reloginChanged")}</Text>
        </View>
      ) : null}
      <Field label={t("login_id")} value={id} onChangeText={setId} autoCorrect={false} />
      <Field label={t("login_password")} value={pw} onChangeText={setPw} secureTextEntry onSubmitEditing={submit} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label={busy ? t("auth_working") : t("login_button")} onPress={submit} disabled={busy} />
      {busy ? <Text style={styles.muted}>{t("auth_waking")}</Text> : null}

      <Pressable onPress={() => router.push("/forgot")} style={{ alignSelf: "center" }}>
        <Text style={styles.link}>{t("login_forgot")}</Text>
      </Pressable>

      <View style={styles.signupRow}>
        <Text style={styles.muted}>{t("login_noAccount")}</Text>
        <Pressable onPress={() => router.push("/signup")}>
          <Text style={styles.link}>{t("login_signup")}</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lang: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-end" },
  langText: { color: colors.muted, fontSize: 14 },
  brand: { alignItems: "center", marginVertical: space.xl },
  logo: { color: colors.text, fontSize: 40, fontWeight: "800", letterSpacing: 2 },
  sub: { color: colors.muted, fontSize: 14, marginTop: 6 },
  signupRow: { flexDirection: "row", justifyContent: "center", gap: space.sm },
  muted: { color: colors.muted, textAlign: "center" },
  link: { color: colors.primary, fontWeight: "700" },
  notice: { flexDirection: "row", alignItems: "center", gap: space.sm, padding: space.md, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.primary },
  noticeText: { color: colors.text, fontSize: 14, flex: 1 },
  error: { color: colors.danger, fontSize: 14 },
});
