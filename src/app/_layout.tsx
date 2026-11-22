import "@/i18n";

import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useTranslation } from "react-i18next";

import { headerOptions } from "@/components/ui";
import { loadSavedLanguage } from "@/i18n";
import { SessionProvider, useSession } from "@/state/session";
import { colors } from "@/theme";

export default function RootLayout() {
  // 저장된 언어를 먼저 불러온 뒤 화면을 그린다(잠깐 다른 언어가 보이는 것을 방지).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadSavedLanguage()
      .catch(() => null)
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SessionProvider>
      <StatusBar style="light" />
      <RootStack />
    </SessionProvider>
  );
}

function RootStack() {
  const { t } = useTranslation();
  const { ready } = useSession();
  // 저장된 로그인 정보를 읽기 전에는 화면을 그리지 않는다
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  return (
    <Stack screenOptions={{ ...headerOptions, headerBackButtonDisplayMode: "minimal" }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="language" options={{ title: t("language_title") }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="signup" options={{ title: t("signup_title") }} />
      <Stack.Screen name="pending" options={{ headerShown: false }} />
      <Stack.Screen name="forgot" options={{ title: t("forgot_title") }} />
      <Stack.Screen name="change-password" options={{ title: t("pw_title") }} />
      <Stack.Screen name="profile-photo" options={{ title: t("avatar_title") }} />
      <Stack.Screen name="student" options={{ headerShown: false }} />
      <Stack.Screen name="teacher" options={{ headerShown: false }} />
      <Stack.Screen name="staff" options={{ headerShown: false }} />
      <Stack.Screen name="admin" options={{ headerShown: false }} />
      <Stack.Screen name="result/[id]" options={{ title: t("result_title") }} />
      <Stack.Screen name="course/[id]" options={{ title: t("teacher_title") }} />
      <Stack.Screen name="boards" options={{ title: t("admin_boards") }} />
      <Stack.Screen name="gallery" options={{ title: t("tab_gallery") }} />
      <Stack.Screen name="ranking" options={{ title: t("tab_ranking") }} />
      <Stack.Screen name="notifications" options={{ title: t("noti_title") }} />
      <Stack.Screen name="manage" options={{ headerShown: false }} />
      <Stack.Screen name="student-view/[id]" options={{ title: t("student_records") }} />
      <Stack.Screen name="settings/index" options={{ title: t("settings_title") }} />
      <Stack.Screen name="settings/profile" options={{ title: t("profile_title") }} />
      <Stack.Screen name="settings/privacy" options={{ title: t("privacy_title") }} />
      <Stack.Screen name="settings/delete-account" options={{ title: t("delete_title") }} />
    </Stack>
  );
}
