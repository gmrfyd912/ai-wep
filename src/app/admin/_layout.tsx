import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";

import { useRoleRedirect } from "@/components/guard";
import { headerOptions, SettingsButton } from "@/components/ui";

export default function AdminLayout() {
  const { t } = useTranslation();
  const redirect = useRoleRedirect("admin");
  if (redirect) return redirect;
  return (
    <Stack screenOptions={{ ...headerOptions, headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen
        name="index"
        options={{
          title: t("admin_title"),
          headerRight: () => <SettingsButton />,
        }}
      />
    </Stack>
  );
}
