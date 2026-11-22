import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Body, Card, ListRow, Screen } from "@/components/ui";
import { LANGUAGES } from "@/i18n";
import { logout as serverLogout } from "@/lib/api";
import { useSession } from "@/state/session";

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const { user, signOut } = useSession();
  const langName = LANGUAGES.find((l) => l.code === i18n.language)?.nativeName;

  const logout = async () => {
    await serverLogout().catch(() => null); // 서버가 잠들어 있어도 휴대폰에서는 바로 로그아웃
    await signOut();
    if (router.canDismiss()) router.dismissAll();
    router.replace("/login");
  };

  return (
    <Screen>
      {user ? (
        <Card>
          <Body>{user.name}</Body>
          <Body muted>
            {user.login_id} · {t(`role_${user.role}`)}
          </Body>
        </Card>
      ) : null}
      <ListRow icon="globe-outline" title={t("settings_language")} desc={langName} onPress={() => router.push("/language")} />
      <ListRow icon="person-circle-outline" title={t("settings_profile")} onPress={() => router.push("/settings/profile")} />
      <ListRow icon="key-outline" title={t("pw_title")} onPress={() => router.push("/change-password")} />
      <ListRow icon="shield-outline" title={t("settings_privacy")} onPress={() => router.push("/settings/privacy")} />
      <ListRow icon="log-out-outline" title={t("settings_logout")} onPress={logout} />
    </Screen>
  );
}
