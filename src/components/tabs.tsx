import Ionicons from "@expo/vector-icons/Ionicons";
import type { ColorValue } from "react-native";

import { BackToLoginButton } from "@/components/preview";
import { SettingsButton, type IconName } from "@/components/ui";
import { colors } from "@/theme";

/** 역할별 탭 화면에서 공통으로 쓰는 탭 스타일 */
export const tabScreenOptions = {
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerTitleStyle: { fontWeight: "700" as const },
  headerShadowVisible: false,
  headerLeft: () => <BackToLoginButton />,
  headerRight: () => <SettingsButton />,
  sceneStyle: { backgroundColor: colors.bg },
  tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
  tabBarActiveTintColor: colors.primary,
  tabBarInactiveTintColor: colors.muted,
};

export const tabIcon =
  (name: IconName) =>
  ({ color, size }: { color: ColorValue; size: number }) => (
    <Ionicons name={name} color={typeof color === "string" ? color : undefined} size={size} />
  );
