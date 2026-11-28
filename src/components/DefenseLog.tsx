import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { StudyBuddy } from "@/components/StudyBuddy";
import { AppButton } from "@/components/ui";
import type { GameDefenseLog, GameDefenseRow } from "@/lib/api";
import { RES_COLOR } from "@/screens/GameMap";
import { colors, radius, space } from "@/theme";

function when(at: string | null) {
  if (!at) return "";
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 시간을 "3시간 20분"처럼 */
export function hm(sec: number, t: TFunction) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? t("gm_df_hm", { h, m }) : t("gm_df_m", { m: Math.max(1, m) });
}

/**
 * 방어 기록 (전체 화면): 누가·언제·어느 길로 왔고, 별·뺏긴 것·막아 낸 보상.
 * [다시 보기] = 상대가 어떻게 공격했는지, [복수하기] = 1번 (보호막·시간 잠금·하루 한도 규칙은 그대로).
 */
export function DefenseLog({
  data,
  onClose,
  onReplay,
  onRevenge,
}: {
  data: GameDefenseLog;
  onClose: () => void;
  onReplay: (id: string) => void;
  onRevenge: (row: GameDefenseRow) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const tip = data.tip;
  const tipText =
    tip.id === "lane" ? t("gm_df_tip_lane", { lane: t(`gm_bt_lane_${tip.lane}`), n: tip.n }) : t(`gm_df_tip_${tip.id}`);
  return (
    <View style={[StyleSheet.absoluteFill, styles.bg, { paddingTop: insets.top + 8, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}>
      <View style={styles.rowBetween}>
        <Text style={styles.title}>{t("gm_df_title")}</Text>
        {data.shield ? <Text style={styles.badge}>🛡 {t("gm_df_shield", { left: hm(data.shield, t) })}</Text> : null}
        <View style={{ flex: 1 }} />
        <Pressable onPress={onClose} style={styles.round} hitSlop={8} accessibilityLabel={t("common_back")}>
          <Ionicons name="close" size={18} color="#fff" />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ gap: space.sm, paddingVertical: space.sm, paddingBottom: insets.bottom + 16 }}>
        <StudyBuddy compact size={44} text={data.ready ? tipText : t("gm_err_need_sql19")} />
        <Text style={styles.small}>{t("gm_df_rule")}</Text>
        {data.ready && !data.log.length ? <Text style={styles.text}>{t("gm_df_empty")}</Text> : null}
        {data.log.map((r) => {
          const held = r.stars <= 1;
          const canRevenge = !r.revenge_used && !r.revenge_block;
          return (
            <View key={r.id} style={[styles.card, !r.seen && { borderColor: "#FFD166" }]}>
              <View style={styles.rowBetween}>
                <Text style={styles.textB} numberOfLines={1}>
                  {t("gm_df_row", { name: r.by, lane: r.lane ? t(`gm_bt_lane_${r.lane}`) : "" })}
                </Text>
                <Text style={styles.small}>{when(r.at)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={[styles.tag, { backgroundColor: held ? "#2E9D5B" : "#D0453A" }]}>{t(held ? "gm_df_held" : "gm_df_broken")}</Text>
                <Text style={styles.stars}>{[0, 1, 2].map((k) => (k < r.stars ? "★" : "☆")).join("")}</Text>
                {(["steel", "rods"] as const).map((k) =>
                  r.lost[k] ? (
                    <View key={k} style={styles.res}>
                      <View style={[styles.dot, { backgroundColor: RES_COLOR[k] }]} />
                      <Text style={styles.text}>−{r.lost[k]}</Text>
                    </View>
                  ) : null,
                )}
                {(["rods", "fame"] as const).map((k) =>
                  r.defend[k] ? (
                    <View key={`d${k}`} style={styles.res}>
                      <View style={[styles.dot, { backgroundColor: RES_COLOR[k] }]} />
                      <Text style={[styles.text, { color: "#7FD18F" }]}>+{r.defend[k]}</Text>
                    </View>
                  ) : null,
                )}
              </View>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <AppButton label={t("gm_df_replay")} icon="play-outline" variant="secondary" onPress={() => onReplay(r.id)} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppButton label={t(r.revenge_used ? "gm_df_revengeDone" : "gm_df_revenge")} icon="flag-outline" disabled={!canRevenge}
                    onPress={() => onRevenge(r)} />
                </View>
              </View>
              {!r.revenge_used && r.revenge_block ? (
                <Text style={styles.warnSm}>{t(`gm_rd_block_${r.revenge_block}`, r.revenge_info as Record<string, unknown>)}</Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const HUD = "#0B2033D9";
const styles = StyleSheet.create({
  bg: { backgroundColor: "#0B1A2A", zIndex: 56 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: 8 },
  round: { width: 34, height: 34, borderRadius: 17, backgroundColor: HUD, alignItems: "center", justifyContent: "center" },
  title: { color: "#FFD166", fontSize: 18, fontWeight: "800" },
  badge: { color: "#fff", fontSize: 12, backgroundColor: "#FFFFFF1F", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden" },
  card: { backgroundColor: "#0F2236", borderRadius: radius.md, borderWidth: 1, borderColor: "#FFFFFF22", padding: space.sm, gap: 6, maxWidth: 640 },
  tag: { color: "#fff", fontSize: 12, fontWeight: "700", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden" },
  stars: { color: "#FFD166", fontSize: 14 },
  res: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  text: { color: "#fff", fontSize: 14 },
  textB: { color: "#fff", fontSize: 15, fontWeight: "700", flex: 1 },
  small: { color: "#FFFFFFBB", fontSize: 12 },
  warnSm: { color: colors.warning, fontSize: 12 },
});
