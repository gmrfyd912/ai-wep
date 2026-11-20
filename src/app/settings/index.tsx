import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Body, Card, ListRow, Screen } from "@/components/ui";
import { LANGUAGES } from "@/i18n";
import { useSession } from "@/state/session";

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { role, setRole } = useSession();
  const langName = LANGUAGES.find((l) => l.code === i18n.language)?.nativeName;

  const logout = () => {
    setRole(null);
    router.dismissAll();
    router.replace("/login");
  };

  return (
    <Screen>
      {role ? (
        <Card>
          <Body muted>{t("settings_currentRole")}</Body>
          <Body>{t(`role_${role}`)}</Body>
        </Card>
      ) : null}
      <ListRow icon="globe-outline" title={t("settings_language")} desc={langName} onPress={() => router.push("/language")} />
      <ListRow icon="person-circle-outline" title={t("settings_profile")} onPress={() => router.push("/settings/profile")} />
      <ListRow icon="shield-outline" title={t("settings_privacy")} onPress={() => router.push("/settings/privacy")} />
      <ListRow icon="log-out-outline" title={t("settings_logout")} onPress={logout} />
      <ListRow icon="trash-outline" title={t("settings_deleteAccount")} onPress={() => router.push("/settings/delete-account")} danger />
    </Screen>
  );
}
