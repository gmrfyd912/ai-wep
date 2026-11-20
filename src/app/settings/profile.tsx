import { useTranslation } from "react-i18next";

import { ComingSoon, Field, Screen } from "@/components/ui";

export default function ProfileScreen() {
  const { t } = useTranslation();
  return (
    <Screen>
      <Field label={t("signup_name")} editable={false} placeholder="—" />
      <Field label={t("login_id")} editable={false} placeholder="—" />
      <Field label={t("signup_course")} editable={false} placeholder="—" />
      <ComingSoon step={6} />
    </Screen>
  );
}
