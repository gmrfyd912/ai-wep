import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { ListRow, Screen } from "@/components/ui";

export default function AdminHome() {
  const { t } = useTranslation();
  return (
    <Screen>
      <ListRow icon="images-outline" title={t("tab_gallery")} desc={t("admin_galleryDesc")} onPress={() => router.push("/gallery")} />
      <ListRow icon="trophy-outline" title={t("tab_ranking")} desc={t("admin_rankingDesc")} onPress={() => router.push("/ranking")} />
      <ListRow icon="podium-outline" title={t("sb_title")} desc={t("sb_desc")} onPress={() => router.push("/study-board")} />
      <ListRow icon="grid-outline" title={t("admin_boards")} desc={t("admin_boardsDesc")} onPress={() => router.push("/boards")} />
      <ListRow icon="library-outline" title={t("admin_courses")} desc={t("admin_coursesDesc")} onPress={() => router.push("/manage/courses")} />
      <ListRow icon="people-outline" title={t("admin_members")} desc={t("admin_membersDesc")} onPress={() => router.push("/manage/members")} />
      <ListRow icon="person-add-outline" title={t("admin_signupSettings")} desc={t("admin_signupSettingsDesc")} onPress={() => router.push("/manage/signup-settings")} />
      <ListRow icon="options-outline" title={t("admin_criteria")} desc={t("admin_criteriaDesc")} onPress={() => router.push("/manage/criteria")} />
      <ListRow icon="shield-checkmark-outline" title={t("admin_rules")} desc={t("admin_rulesDesc")} onPress={() => router.push("/manage/rules")} />
      <ListRow icon="book-outline" title={t("admin_textbooks")} desc={t("admin_textbooksDesc")} onPress={() => router.push("/manage/textbooks")} />
      <ListRow icon="help-circle-outline" title={t("qb_title")} desc={t("admin_quizDesc")} onPress={() => router.push("/manage/quiz")} />
      <ListRow icon="chatbubbles-outline" title={t("tutor_reportsTitle")} desc={t("admin_tutorDesc")} onPress={() => router.push("/manage/tutor-reports")} />
      <ListRow icon="checkmark-done-outline" title={t("tc_title")} desc={t("admin_tutorChecksDesc")} onPress={() => router.push("/manage/tutor-checks")} />
      <ListRow icon="cloud-download-outline" title={t("admin_training")} desc={t("admin_trainingDesc")} onPress={() => router.push("/manage/training")} />
    </Screen>
  );
}
