import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, ComingSoon, Screen } from "@/components/ui";
import { colors } from "@/theme";

export default function DeleteAccountScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <Card style={{ borderColor: colors.danger }}>
        <Ionicons name="warning-outline" size={28} color={colors.danger} />
        <Body>{t("delete_warning")}</Body>
      </Card>
      <AppButton label={t("delete_button")} variant="danger" disabled />
      <ComingSoon step={6} />
    </Screen>
  );
}
