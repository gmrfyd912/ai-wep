import { useTranslation } from "react-i18next";

import { Body, Card, Screen } from "@/components/ui";

export default function PrivacyScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <Card>
        <Body>{t("privacy_draft")}</Body>
      </Card>
    </Screen>
  );
}
