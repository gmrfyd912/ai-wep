import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { ListRow, Screen } from "@/components/ui";

export default function AdminHome() {
  const { t } = useTranslation();
  return (
    <Screen>
      <ListRow icon="grid-outline" title={t("admin_boards")} desc={t("admin_boardsDesc")} onPress={() => router.push("/boards")} />
      <ListRow icon="library-outline" title={t("admin_courses")} desc={t("admin_coursesDesc")} onPress={() => router.push("/manage/courses")} />
      <ListRow icon="people-outline" title={t("admin_members")} desc={t("admin_membersDesc")} onPress={() => router.push("/manage/members")} />
      <ListRow icon="person-add-outline" title={t("admin_signupSettings")} desc={t("admin_signupSettingsDesc")} onPress={() => router.push("/manage/signup-settings")} />
    </Screen>
  );
}
