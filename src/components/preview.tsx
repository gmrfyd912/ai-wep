import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { BackHandler, Pressable, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { useSession } from "@/state/session";
import { colors } from "@/theme";

// ⚠️ 역할 미리보기 전용 임시 기능. 6단계에서 실제 로그인을 붙일 때 삭제한다.

function useGoToLogin() {
  const { setRole } = useSession();
  return useCallback(() => {
    setRole(null);
    router.replace("/login");
  }, [setRole]);
}

/** 헤더 왼쪽 "← 로그인" 버튼 */
export function BackToLoginButton() {
  const { t } = useTranslation();
  const goToLogin = useGoToLogin();
  return (
    <Pressable
      onPress={goToLogin}
      hitSlop={12}
      style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12 }}
    >
      <Ionicons name="chevron-back" size={20} color={colors.text} />
      <Text style={{ color: colors.text, fontSize: 15 }}>{t("common_toLogin")}</Text>
    </Pressable>
  );
}

/** 안드로이드 뒤로가기: 더 돌아갈 화면이 없으면 앱을 닫지 않고 로그인 화면으로 */
export function useBackToLoginOnHardwareBack() {
  const goToLogin = useGoToLogin();
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (router.canGoBack()) return false; // 이전 화면이 있으면 평소처럼 뒤로
        goToLogin();
        return true;
      });
      return () => sub.remove();
    }, [goToLogin]),
  );
}
