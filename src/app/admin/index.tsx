import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { ListRow, Screen } from "@/components/ui";

export default function AdminHome() {
  const { t } = useTranslation();
  return (
    <Screen>
      <ListRow icon="library-outline" title={t("admin_courses")} desc={t("admin_coursesDesc")} onPress={() => router.push("/admin/courses")} />
      <ListRow icon="people-outline" title={t("admin_members")} desc={t("admin_membersDesc")} onPress={() => router.push("/admin/members")} />
      <ListRow icon="key-outline" title={t("admin_permissions")} desc={t("admin_permissionsDesc")} onPress={() => router.push("/admin/permissions")} />
      <ListRow icon="person-add-outline" title={t("admin_signupSettings")} desc={t("admin_signupSettingsDesc")} onPress={() => router.push("/admin/signup-settings")} />
    </Screen>
  );
}
