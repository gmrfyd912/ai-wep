import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";

import { unreadCount } from "@/lib/api";
import { colors, space } from "@/theme";

// 읽지 않은 알림 수: 앱 전체에서 하나만 두고, 알림 화면에서 읽으면 바로 줄어들게 한다
let count = 0;
const listeners = new Set<(n: number) => void>();
let lastFetch = 0;

function set(n: number) {
  count = n;
  listeners.forEach((f) => f(n));
}

/** 서버에서 다시 받아 온다 (force 가 아니면 20초 안에 다시 부르지 않음) */
export function refreshUnread(force = false) {
  if (!force && Date.now() - lastFetch < 20_000) return;
  lastFetch = Date.now();
  unreadCount()
    .then((r) => set(r.count))
    .catch(() => null);
}

export function setUnread(n: number) {
  set(n);
}

/** 헤더의 종 아이콘. 빨간 숫자 = 읽지 않은 댓글 알림 */
export function NotificationBell() {
  const [n, setN] = useState(count);
  useEffect(() => {
    listeners.add(setN);
    refreshUnread(true);
    const timer = setInterval(() => refreshUnread(true), 60_000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && refreshUnread());
    return () => {
      listeners.delete(setN);
      clearInterval(timer);
      sub.remove();
    };
  }, []);
  return (
    <Pressable onPress={() => router.push("/notifications")} hitSlop={10} style={{ paddingHorizontal: space.sm }}>
      <Ionicons name={n ? "notifications" : "notifications-outline"} size={22} color={colors.text} />
      {n ? (
        <View
          style={{
            position: "absolute",
            top: -4,
            right: 0,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            paddingHorizontal: 4,
            backgroundColor: colors.danger,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{n > 99 ? "99+" : n}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
