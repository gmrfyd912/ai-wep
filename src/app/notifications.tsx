import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { setUnread } from "@/components/NotificationBell";
import { Body, Card, Screen } from "@/components/ui";
import { listNotifications, markNotificationsRead, type NotificationItem } from "@/lib/api";
import { colors, space } from "@/theme";

/** 알림: 내 글에 댓글, 내 댓글에 답글. 열면 모두 읽음으로 바뀌고, 누르면 그 결과(댓글)로 간다 */
export default function Notifications() {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setError(false);
      listNotifications()
        .then((r) => {
          setItems(r);
          if (r.some((n) => !n.read)) {
            markNotificationsRead()
              .then(() => setUnread(0))
              .catch(() => null);
          } else setUnread(0);
        })
        .catch(() => setError(true));
    }, []),
  );

  if (error) return <Screen><Text style={styles.error}>{t("error_network")}</Text></Screen>;
  if (!items) return <Screen><ActivityIndicator color={colors.primary} /></Screen>;

  return (
    <Screen>
      {items.length === 0 ? <Body muted>{t("noti_empty")}</Body> : null}
      {items.map((n) => (
        <Card
          key={n.id}
          style={n.read ? styles.row : { ...styles.row, ...styles.unread }}
          onPress={n.submission_id ? () => router.push({ pathname: "/result/[id]", params: { id: n.submission_id!, focus: "comments" } }) : undefined}
        >
          <Ionicons name={n.kind === "reply" ? "return-down-forward-outline" : "chatbubble-outline"} size={20} color={colors.primary} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.title}>
              {t(n.kind === "reply" ? "noti_reply" : "noti_comment", { name: n.actor_name ?? "?" })}
            </Text>
            {n.body ? <Text style={styles.body} numberOfLines={2}>“{n.body}”</Text> : null}
            <Text style={styles.meta}>
              {[n.process, n.position].filter(Boolean).join(" · ")}
              {n.process || n.position ? " · " : ""}
              {new Date(n.created_at).toLocaleString(i18n.language)}
            </Text>
          </View>
          {!n.read ? <View style={styles.dot} /> : null}
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  unread: { borderColor: colors.primary, borderWidth: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: "700" },
  body: { color: colors.muted, fontSize: 14 },
  meta: { color: colors.faint, fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger, marginTop: 6 },
  error: { color: colors.danger },
});
