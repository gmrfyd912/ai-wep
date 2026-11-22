import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, BeadStrip } from "@/components/Avatar";
import { Body, Card, Chips, Label, Screen } from "@/components/ui";
import { getRanking, listCourses, type Course, type RankPeriod, type RankRow } from "@/lib/api";
import { POSITIONS, PROCESSES } from "@/lib/weld";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

const MEDAL = ["🥇", "🥈", "🥉"];

/** 랭킹: 교육생 순위 (기간 안 최고 점수). 기본은 우리 반·주간·공정 전체·자세 전체.
 * 공정·자세를 고르면 그것끼리만 비교. 사람을 누르면 그 사람의 기록 전체 */
export function RankingScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const mine = user?.courses?.map((c) => c.id) ?? [];
  const [courses, setCourses] = useState<Course[]>([]);
  const [course, setCourse] = useState<string>(mine[0] ?? "all");
  const [period, setPeriod] = useState<RankPeriod>("week");
  const [proc, setProc] = useState<string>(""); // "" = 전체
  const [pos, setPos] = useState<string>("");
  const [data, setData] = useState<{ rows: RankRow[]; me: RankRow | null; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const req = useRef(0);

  useEffect(() => {
    listCourses()
      .then(setCourses)
      .catch(() => null);
  }, []);

  const load = useCallback(() => {
    const n = ++req.current;
    setFailed(false);
    setData(null);
    getRanking({ process: proc, position: pos, period, course })
      .then((r) => n === req.current && setData(r))
      .catch(() => n === req.current && setFailed(true));
  }, [proc, pos, period, course]);
  useFocusEffect(load);

  const courseOptions = [
    ...courses.filter((c) => mine.includes(c.id)).map((c) => ({ value: c.id, label: t("gallery_myCourse", { name: c.name }) })),
    { value: "all", label: t("ranking_allCourses") },
    ...courses.filter((c) => !mine.includes(c.id)).map((c) => ({ value: c.id, label: c.name })),
  ];
  const meShown = data?.me && data.rows.some((r) => r.user_id === data.me!.user_id);

  return (
    <Screen>
      <Chips options={courseOptions} value={course} onChange={setCourse} />
      <Chips<RankPeriod>
        options={[
          { value: "day", label: t("ranking_day") },
          { value: "week", label: t("ranking_week") },
          { value: "month", label: t("ranking_month") },
          { value: "all", label: t("ranking_all") },
        ]}
        value={period}
        onChange={setPeriod}
      />
      <Label>{t("upload_process")}</Label>
      <Chips
        options={[{ value: "", label: t("common_all") }, ...PROCESSES.map((v) => ({ value: v, label: v }))]}
        value={proc}
        onChange={setProc}
      />
      <Label>{t("upload_position")}</Label>
      <Chips
        options={[{ value: "", label: t("common_all") }, ...POSITIONS.map((v) => ({ value: v, label: v }))]}
        value={pos}
        onChange={setPos}
      />
      <Text style={styles.hint}>{t(proc || pos ? "ranking_rule" : "ranking_ruleAll")}</Text>

      {failed ? <Text style={styles.error}>{t("error_network")}</Text> : null}
      {!data && !failed ? <ActivityIndicator color={colors.primary} /> : null}
      {data?.me && !meShown ? <RankCard r={data.me} me mixed={!proc || !pos} /> : null}
      {data && data.rows.length === 0 ? <Body muted>{t("ranking_empty")}</Body> : null}
      {data?.rows.map((r) => (
        <RankCard key={r.user_id} r={r} me={r.user_id === user?.id} mixed={!proc || !pos} />
      ))}
      {data && data.total > data.rows.length ? (
        <Text style={styles.hint}>{t("ranking_top", { n: data.rows.length, total: data.total })}</Text>
      ) : null}
    </Screen>
  );
}

/** mixed: 공정·자세 전체로 볼 때는 최고 점수를 낸 공정·자세도 함께 보여 준다 */
function RankCard({ r, me, mixed }: { r: RankRow; me?: boolean; mixed?: boolean }) {
  const { t, i18n } = useTranslation();
  const date = new Date(r.created_at).toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" });
  const c = r.score >= 85 ? colors.success : r.score >= 70 ? colors.warning : colors.danger;
  return (
    <Card
      style={me ? { ...styles.row, ...styles.me } : styles.row}
      onPress={() => router.push({ pathname: "/student-view/[id]", params: { id: r.user_id } })}
    >
      <View style={styles.top}>
        <Text style={[styles.rank, r.rank <= 3 && styles.medal]}>{r.rank <= 3 ? MEDAL[r.rank - 1] : t("ranking_rank", { rank: r.rank })}</Text>
        <Avatar url={r.avatar_url} cacheKey={r.avatar_key} name={r.name} size={38} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {r.name}
            {me ? <Text style={styles.meTag}>  {t("ranking_me")}</Text> : null}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {r.courses.join(", ")}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {mixed ? `${[r.process, r.position].filter(Boolean).join(" · ")} · ` : ""}
            {t("ranking_bestOn", { date })}
          </Text>
        </View>
        <Text style={[styles.score, { color: c }]}>{t("common_points", { score: r.score })}</Text>
      </View>
      <BeadStrip url={r.bead_url} cacheKey={r.bead_key} ratio={r.bead_ratio} />
    </Card>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.faint, fontSize: 12 },
  error: { color: colors.danger },
  row: { gap: space.sm, paddingVertical: space.md },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  me: { borderColor: colors.primary, borderWidth: 1 },
  rank: { color: colors.muted, fontWeight: "800", fontSize: 15, minWidth: 40, textAlign: "center" },
  medal: { fontSize: 26 },
  name: { color: colors.text, fontWeight: "700", fontSize: 15 },
  meTag: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 12 },
  score: { fontWeight: "800", fontSize: 16 },
});
