import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { ListRow, Screen } from "@/components/ui";

export default function AdminHome() {
  const { t } = useTranslation();
  return (
    <Screen>
      <ListRow icon="images-outline" title={t("tab_gallery")} desc={t("admin_galleryDesc")} onPress={() => router.push("/gallery")} />
      <ListRow icon="trophy-outline" title={t("tab_ranking")} desc={t("admin_rankingDesc")} onPress={() => router.push("/ranking")} />
      <ListRow icon="grid-outline" title={t("admin_boards")} desc={t("admin_boardsDesc")} onPress={() => router.push("/boards")} />
      <ListRow icon="library-outline" title={t("admin_courses")} desc={t("admin_coursesDesc")} onPress={() => router.push("/manage/courses")} />
      <ListRow icon="people-outline" title={t("admin_members")} desc={t("admin_membersDesc")} onPress={() => router.push("/manage/members")} />
      <ListRow icon="person-add-outline" title={t("admin_signupSettings")} desc={t("admin_signupSettingsDesc")} onPress={() => router.push("/manage/signup-settings")} />
    </Screen>
  );
}
