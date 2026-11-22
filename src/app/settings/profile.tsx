import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { AppButton, Field, Screen } from "@/components/ui";
import { authErrorKey, updateEmail } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

/** 내 정보: 이름·아이디·역할·과정은 보기만, 이메일은 바꿀 수 있다. 맨 아래에 계정 삭제 (설정의 로그아웃과 떨어뜨려 잘못 누르지 않게) */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const { user, setUser } = useSession();
  const [email, setEmail] = useState(user?.email ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const save = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const me = await updateEmail(email.trim() || null);
      setUser(me);
      setEmail(me.email ?? "");
      setMsg({ ok: true, text: t("profile_saved") });
    } catch (e) {
      const { key, values } = authErrorKey(e);
      setMsg({ ok: false, text: t(key as "error_network", values) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Pressable style={styles.photo} onPress={() => router.push("/profile-photo")} accessibilityLabel={t("avatar_change")}>
        <Avatar url={user.avatar_url} cacheKey={user.avatar_key} name={user.name} size={88} />
        <Text style={styles.photoText}>{t("avatar_change")}</Text>
      </Pressable>
      <Field label={t("signup_name")} editable={false} value={user.name} />
      <Field label={t("login_id")} editable={false} value={user.login_id} />
      <Field label={t("profile_role")} editable={false} value={t(`role_${user.role}`)} />
      {user.courses.length ? (
        <Field label={t("signup_course")} editable={false} value={user.courses.map((c) => c.name).join(", ")} />
      ) : null}
      <Field label={t("signup_email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCorrect={false} />
      <Text style={styles.hint}>{t("signup_emailHint")}</Text>
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger }}>{msg.text}</Text> : null}
      <AppButton label={busy ? t("auth_working") : t("common_save")} onPress={save} disabled={busy} />
      {user.role !== "admin" ? (
        <View style={styles.deleteBox}>
          <Pressable style={styles.deleteBtn} onPress={() => router.push("/settings/delete-account")}>
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
            <Text style={styles.deleteText}>{t("settings_deleteAccount")}</Text>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: 13 },
  photo: { alignItems: "center", gap: space.xs, paddingVertical: space.sm },
  photoText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  deleteBox: { marginTop: space.xl * 2, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.border, alignItems: "center" },
  deleteBtn: { flexDirection: "row", alignItems: "center", gap: 6, padding: space.sm },
  deleteText: { color: colors.danger, fontSize: 14 },
});
