import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import type { TFunction } from "i18next";
import { Alert } from "react-native";

import { claimDeviceRecords, countDeviceRecords, getDeviceId, type Me, type Role } from "@/lib/api";

export function homeOf(role: Role) {
  return `/${role}` as const;
}

/** 로그인·가입 직후: 새 비밀번호가 필요하면 그 화면으로, 아니면 내 역할 화면으로 보낸다. */
export function goAfterLogin(user: Me, t: TFunction) {
  if (router.canDismiss()) router.dismissAll();
  if (user.must_change_password) {
    router.replace({ pathname: "/change-password", params: { forced: "1" } });
    return;
  }
  router.replace(homeOf(user.role));
  offerDeviceRecords(user, t).catch(() => null);
}

/** 로그인 전에 이 휴대폰으로 분석한 기록이 있으면 "내 계정으로 가져올까요?"라고 한 번만 묻는다. */
export async function offerDeviceRecords(user: Me, t: TFunction) {
  const key = `aiwep.claimAsked.${user.id}.${await getDeviceId()}`;
  if (await AsyncStorage.getItem(key)) return;
  const count = await countDeviceRecords();
  if (count === 0) {
    await AsyncStorage.setItem(key, "1");
    return;
  }
  Alert.alert(t("claim_title"), t("claim_message", { count }), [
    { text: t("claim_no"), style: "cancel", onPress: () => AsyncStorage.setItem(key, "1") },
    {
      text: t("claim_yes"),
      onPress: async () => {
        try {
          const moved = await claimDeviceRecords();
          await AsyncStorage.setItem(key, "1");
          Alert.alert(t("claim_title"), t("claim_done", { count: moved }));
        } catch {
          Alert.alert(t("claim_title"), t("error_network"));
        }
      },
    },
  ]);
}
