import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Card } from "@/components/ui";
import { getTeacherGame, type TeacherGame } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 학습 보드 '게임' 칸 (교사·관리자): 우리 반 대항전, 사람별 공부·전투 점수, 공격만 많은 학생 */
export function TeacherGameTab({ course }: { course: string }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const [v, setV] = useState<TeacherGame | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setV(null);
    setFailed(false);
    getTeacherGame(course).then(setV).catch(() => setFailed(true));
  }, [course]);
  if (failed) return <Text style={styles.warn}>{t("error_network")}</Text>;
  if (!v) return <ActivityIndicator color={colors.primary} />;
  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.small}>{t("tg_note", { a: v.warn.attacks, d: v.warn.days })}</Text>
      {!v.game_on ? <Text style={styles.warn}>{t("tg_gameOff")}</Text> : null}
      {v.classes.length === 0 ? <Text style={styles.small}>{t("tg_noClass")}</Text> : null}
      {v.classes.map((k) => (
        <Card key={k.id} style={{ gap: space.xs }}>
          <Text style={styles.head}>{k.name}</Text>
          {k.contest ? (
            <Text style={styles.text}>
              {k.contest.rival
                ? t("tg_contestVs", { rival: k.contest.rival, us: fmt(k.contest.score), them: fmt(k.contest.rival_score) })
                : t("tg_contestSolo", { us: fmt(k.contest.score), goal: fmt(k.contest.rival_score) })}
              {k.contest.done ? ` · ${k.contest.won ? t("gm_ct_w") : t("gm_ct_l")}` : ` · ${t("gm_ac_live")}`}
            </Text>
          ) : (
            <Text style={styles.small}>{v.contest_on ? t("tg_noContest") : t("gm_ct_off")}</Text>
          )}
          <View style={[styles.row, styles.headRow]}>
            <Text style={[styles.cell, styles.name, styles.colHead]}>{t("tg_colName")}</Text>
            <Text style={[styles.cell, styles.colHead]}>{t("tg_colStudy")}</Text>
            <Text style={[styles.cell, styles.colHead]}>{t("tg_colBattle")}</Text>
            <Text style={[styles.cell, styles.colHead]}>{t("tg_colDays")}</Text>
            <Text style={[styles.cell, styles.colHead]}>{t("tg_colAttacks")}</Text>
            <Text style={[styles.cell, styles.colHead]}>{t("tg_colHq")}</Text>
          </View>
          {k.people.map((p) => (
            <View key={p.id} style={[styles.row, p.warn && styles.warnRow]}>
              <Text style={[styles.cell, styles.name, !p.seen && { color: colors.muted }]} numberOfLines={1}>
                {p.warn ? "⚠️ " : ""}
                {p.name}
              </Text>
              <Text style={styles.cell}>{p.study}</Text>
              <Text style={styles.cell}>{p.battle}</Text>
              <Text style={styles.cell}>{p.days}</Text>
              <Text style={[styles.cell, p.warn && { color: colors.warning, fontWeight: "800" }]}>{p.attacks}</Text>
              <Text style={styles.cell}>{p.hq}</Text>
            </View>
          ))}
          <Text style={styles.small}>{t("tg_legend")}</Text>
        </Card>
      ))}
      {user?.role === "admin" ? (
        <AppButton label={t("tg_settings")} variant="secondary" icon="settings-outline" onPress={() => router.push("/manage/game")} />
      ) : (
        <Text style={styles.small}>{t("tg_askAdmin")}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { color: colors.text, fontSize: 16, fontWeight: "800" },
  text: { color: colors.text, fontSize: 14 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  warn: { color: colors.warning, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 4, borderRadius: 6 },
  headRow: { borderBottomWidth: 1, borderBottomColor: colors.border },
  warnRow: { backgroundColor: "#FFB06622" },
  cell: { width: 44, textAlign: "center", color: colors.text, fontSize: 13 },
  name: { flex: 1, textAlign: "left", paddingLeft: 4 },
  colHead: { color: colors.muted, fontSize: 11, fontWeight: "700" },
});
