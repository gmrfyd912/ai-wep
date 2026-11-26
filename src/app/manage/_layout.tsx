import { Redirect, Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { headerOptions } from "@/components/ui";
import { useSession } from "@/state/session";

/** 관리 화면 묶음: 시스템관리자, 그리고 관리 권한을 받은 행정 관리자만 (화면마다 다시 확인) */
export default function ManageLayout() {
  const { t } = useTranslation();
  const { user } = useSession();
  if (!user) return <Redirect href="/login" />;
  if (user.role !== "admin" && user.role !== "staff") return <Redirect href={`/${user.role}`} />;
  return (
    <Stack screenOptions={{ ...headerOptions, headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="courses" options={{ title: t("admin_courses") }} />
      <Stack.Screen name="course/[id]" options={{ title: t("manage_courseTitle") }} />
      <Stack.Screen name="members" options={{ title: t("admin_members") }} />
      <Stack.Screen name="member/[id]" options={{ title: t("manage_memberTitle") }} />
      <Stack.Screen name="signup-settings" options={{ title: t("admin_signupSettings") }} />
      <Stack.Screen name="criteria" options={{ title: t("admin_criteria") }} />
      <Stack.Screen name="training" options={{ title: t("admin_training") }} />
      <Stack.Screen name="rules" options={{ title: t("admin_rules") }} />
      <Stack.Screen name="rule/[id]" options={{ title: t("rules_editTitle") }} />
      <Stack.Screen name="textbooks" options={{ title: t("admin_textbooks") }} />
      <Stack.Screen name="textbook/[id]" options={{ title: t("tb_editTitle") }} />
      <Stack.Screen name="quiz" options={{ title: t("qb_title") }} />
      <Stack.Screen name="tutor-reports" options={{ title: t("tutor_reportsTitle") }} />
      <Stack.Screen name="questions/[bookId]" options={{ title: t("qb_title") }} />
    </Stack>
  );
}
