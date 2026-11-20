import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useLocalSearchParams } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { Screen, Subtitle } from "@/components/ui";
import { LANGUAGES, setLanguage, type LangCode } from "@/i18n";
import { colors, radius, space } from "@/theme";

export default function LanguageScreen() {
  const { t, i18n } = useTranslation();
  const { first } = useLocalSearchParams<{ first?: string }>();

  const choose = async (code: LangCode) => {
    await setLanguage(code);
    if (first || !router.canGoBack()) router.replace("/login");
    else router.back();
  };

  return (
    <Screen>
      <Subtitle>{t("language_subtitle")}</Subtitle>
      {LANGUAGES.map((l) => {
        const on = i18n.language === l.code;
        return (
          <Pressable key={l.code} onPress={() => choose(l.code)} style={[styles.row, on && styles.rowOn]}>
            <Text style={[styles.text, on && { color: colors.primary }]}>{l.nativeName}</Text>
            {on ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
          </Pressable>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.lg,
  },
  rowOn: { borderColor: colors.primary },
  text: { color: colors.text, fontSize: 17, fontWeight: "600" },
});
