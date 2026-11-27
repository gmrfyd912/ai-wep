import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { ListRow, Screen } from "@/components/ui";
import { canManage } from "@/lib/api";
import { useSession } from "@/state/session";
import { CourseCards } from "@/screens/CourseCards";

/** 행정 관리자: 모든 과정을 한눈에 보는 과정 보드 (+ 시스템관리자가 준 관리 권한이 있으면 관리 메뉴) */
export default function StaffHome() {
  const { t } = useTranslation();
  const { user } = useSession();
  return (
    <Screen>
      {canManage(user, "manage_courses") ? (
        <ListRow icon="school-outline" title={t("admin_courses")} desc={t("admin_coursesDesc")} onPress={() => router.push("/manage/courses")} />
      ) : null}
      {canManage(user, "manage_members") ? (
        <ListRow icon="people-outline" title={t("admin_members")} desc={t("admin_membersDesc")} onPress={() => router.push("/manage/members")} />
      ) : null}
      <ListRow icon="podium-outline" title={t("sb_title")} desc={t("sb_desc")} onPress={() => router.push("/study-board")} />
      <CourseCards />
    </Screen>
  );
}
