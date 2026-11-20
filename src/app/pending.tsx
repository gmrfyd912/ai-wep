import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Screen, Title } from "@/components/ui";
import { colors, space } from "@/theme";

export default function PendingScreen() {
  const { t } = useTranslation();
  return (
    <Screen scroll={false} safeTop>
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", gap: space.lg }}>
        <Ionicons name="hourglass-outline" size={56} color={colors.primary} />
        <Title>{t("pending_title")}</Title>
        <Body muted>{t("pending_desc")}</Body>
        <AppButton label={t("pending_backToLogin")} variant="secondary" onPress={() => router.replace("/login")} />
      </View>
    </Screen>
  );
}
