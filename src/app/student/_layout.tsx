import { Tabs } from "expo-router/js-tabs";
import { useTranslation } from "react-i18next";

import { useRoleRedirect } from "@/components/guard";

import { tabIcon, tabScreenOptions } from "@/components/tabs";

export default function StudentLayout() {
  const { t } = useTranslation();
  const redirect = useRoleRedirect("student");
  if (redirect) return redirect;
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: t("tab_home"), tabBarIcon: tabIcon("home-outline") }} />
      <Tabs.Screen name="theory" options={{ title: t("tab_theory"), tabBarIcon: tabIcon("book-outline") }} />
      <Tabs.Screen name="gallery" options={{ title: t("tab_gallery"), tabBarIcon: tabIcon("images-outline") }} />
      <Tabs.Screen name="upload" options={{ title: t("tab_upload"), tabBarIcon: tabIcon("camera-outline") }} />
      <Tabs.Screen name="ranking" options={{ title: t("tab_ranking"), tabBarIcon: tabIcon("trophy-outline") }} />
      <Tabs.Screen name="records" options={{ title: t("tab_records"), tabBarIcon: tabIcon("document-text-outline") }} />
    </Tabs>
  );
}
