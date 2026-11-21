import { Tabs } from "expo-router/js-tabs";
import { useTranslation } from "react-i18next";

import { useRoleRedirect } from "@/components/guard";

import { tabIcon, tabScreenOptions } from "@/components/tabs";

export default function StaffLayout() {
  const { t } = useTranslation();
  const redirect = useRoleRedirect("staff");
  if (redirect) return redirect;
  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen name="index" options={{ title: t("tab_courseBoard"), tabBarIcon: tabIcon("apps-outline") }} />
      <Tabs.Screen name="gallery" options={{ title: t("tab_gallery"), tabBarIcon: tabIcon("images-outline") }} />
      <Tabs.Screen name="ranking" options={{ title: t("tab_ranking"), tabBarIcon: tabIcon("trophy-outline") }} />
    </Tabs>
  );
}
