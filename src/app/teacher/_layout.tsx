import { Tabs } from "expo-router/js-tabs";
import { useTranslation } from "react-i18next";

import { useBackToLoginOnHardwareBack } from "@/components/preview";

import { tabIcon, tabScreenOptions } from "@/components/tabs";

export default function TeacherLayout() {
  const { t } = useTranslation();
  useBackToLoginOnHardwareBack();
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: t("tab_teacherBoard"), tabBarIcon: tabIcon("grid-outline") }} />
      <Tabs.Screen name="gallery" options={{ title: t("tab_gallery"), tabBarIcon: tabIcon("images-outline") }} />
      <Tabs.Screen name="ranking" options={{ title: t("tab_ranking"), tabBarIcon: tabIcon("trophy-outline") }} />
    </Tabs>
  );
}
