import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, ComingSoon, Field, Screen, SectionTitle } from "@/components/ui";
import { LANGUAGES } from "@/i18n";
import { useSession, type Role } from "@/state/session";
import { colors, space } from "@/theme";

const PREVIEW_ROLES: { role: Role; icon: "school-outline" | "easel-outline" | "briefcase-outline" | "shield-checkmark-outline" }[] = [
  { role: "student", icon: "school-outline" },
  { role: "teacher", icon: "easel-outline" },
  { role: "staff", icon: "briefcase-outline" },
  { role: "admin", icon: "shield-checkmark-outline" },
];

export default function LoginScreen() {
  const { t, i18n } = useTranslation();
  const { setRole } = useSession();
  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [tried, setTried] = useState(false);
  const langName = LANGUAGES.find((l) => l.code === i18n.language)?.nativeName ?? "";

  const preview = (role: Role) => {
    setRole(role);
    router.replace(`/${role}`);
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

      <Field label={t("login_id")} value={id} onChangeText={setId} />
      <Field label={t("login_password")} value={pw} onChangeText={setPw} secureTextEntry />
      <AppButton label={t("login_button")} onPress={() => setTried(true)} />
      {tried ? <ComingSoon step={6} /> : null}

      <View style={styles.signupRow}>
        <Text style={styles.muted}>{t("login_noAccount")}</Text>
        <Pressable onPress={() => router.push("/signup")}>
          <Text style={styles.link}>{t("login_signup")}</Text>
        </Pressable>
      </View>

      <Card style={{ marginTop: space.lg, borderStyle: "dashed" }}>
        <SectionTitle>{t("login_previewTitle")}</SectionTitle>
        <Body muted>{t("login_previewDesc")}</Body>
        <View style={styles.previewGrid}>
          {PREVIEW_ROLES.map(({ role, icon }) => (
            <View key={role} style={styles.previewItem}>
              <AppButton label={t(`role_${role}`)} icon={icon} variant="secondary" onPress={() => preview(role)} />
            </View>
          ))}
        </View>
      </Card>
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
  muted: { color: colors.muted },
  link: { color: colors.primary, fontWeight: "700" },
  previewGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  previewItem: { width: "48%" },
});
