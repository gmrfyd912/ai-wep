import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { getGameSeason, type GameSeason } from "@/lib/api";
import { colors, radius, space } from "@/theme";

const DAY = 24 * 3600 * 1000;
export const BADGE_ICON: Record<string, string> = { gold: "🥇", silver: "🥈", bronze: "🥉", join: "🎖️" };

/** 조선소 위 가운데: 이번 달 명성 순위 (누르면 순위 창) */
export function SeasonChip({ v, onPress }: { v: GameSeason | null; onPress: () => void }) {
  const { t } = useTranslation();
  if (!v?.on || !v.me) return null;
  return (
    <Pressable onPress={onPress} style={styles.chip} hitSlop={6}>
      <Text style={styles.chipText} numberOfLines={1}>
        {v.me.badge ? BADGE_ICON[v.me.badge] : "🏅"} {t("gm_ss_chip", { n: v.me.rank })}
      </Text>
    </Pressable>
  );
}

/** 순위 창 내용: 우리 반 / 전체(과정 고르기), 시즌 끝 안내, 내 배지 */
export function SeasonBody({ first, onLoaded, errorText }: {
  first: GameSeason | null;
  onLoaded: (v: GameSeason) => void;
  errorText: (e: unknown) => string;
}) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<"class" | "all">("class");
  const [course, setCourse] = useState<string | null>(null);
  const [v, setV] = useState<GameSeason | null>(first);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const errRef = useRef(errorText);
  errRef.current = errorText;
  const loadedRef = useRef(onLoaded);
  loadedRef.current = onLoaded;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    getGameSeason(scope, course)
      .then((r) => {
        if (!alive) return;
        setV(r);
        setErr("");
        if (scope === "class") loadedRef.current(r);
      })
      .catch((e) => alive && setErr(errRef.current(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [scope, course]);

  if (!v) return err ? <Text style={styles.warn}>{err}</Text> : <ActivityIndicator color={colors.primary} />;
  if (!v.on) return <Text style={styles.small}>{t("gm_ss_off")}</Text>;
  const days = Math.max(0, Math.ceil((new Date(v.ends_at!).getTime() - Date.now()) / DAY));
  const mine = v.rows?.some((r) => r.id === v.me?.id);
  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.small}>
        {t("gm_ss_ends", { m: Number(v.season!.slice(5)), d: days, keep: v.keep_pct })}
      </Text>
      <View style={styles.tabs}>
        {(["class", "all"] as const).map((k) => (
          <Pressable key={k} onPress={() => { setScope(k); setCourse(null); }} style={[styles.tab, scope === k && styles.tabOn]}>
            <Text style={styles.tabText}>{k === "class" ? t("gm_ss_class", { name: v.class_name || "" }) : t("gm_ss_all")}</Text>
          </Pressable>
        ))}
      </View>
      {scope === "all" && v.courses?.length ? (
        <View style={styles.tabs}>
          {[{ id: null as string | null, name: t("gm_ss_allCourses") }, ...v.courses].map((c) => (
            <Pressable key={c.id ?? "all"} onPress={() => setCourse(c.id)} style={[styles.small2, course === c.id && styles.tabOn]}>
              <Text style={styles.tabText2}>{c.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {err ? <Text style={styles.warn}>{err}</Text> : null}
      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {v.rows?.length === 0 ? <Text style={styles.small}>{t("gm_ss_empty")}</Text> : null}
      {v.rows?.map((r) => (
        <View key={r.id} style={[styles.row, r.id === v.me?.id && styles.meRow]}>
          <Text style={styles.rank}>{r.rank}</Text>
          <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
            {r.badge ? `${BADGE_ICON[r.badge]} ` : ""}
            {r.name}
            {scope === "all" && r.course ? <Text style={styles.small}>  {r.course}</Text> : null}
          </Text>
          <Text style={styles.fame}>{r.fame}</Text>
        </View>
      ))}
      {v.me && !mine ? (
        <View style={[styles.row, styles.meRow]}>
          <Text style={styles.rank}>{v.me.rank}</Text>
          <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>{v.me.name}</Text>
          <Text style={styles.fame}>{v.me.fame}</Text>
        </View>
      ) : null}
      <Text style={styles.small}>{t("gm_ss_how")}</Text>
      <Text style={styles.small}>{t("gm_ss_badgeRule")}</Text>
      {v.my_badges?.length ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.sub}>{t("gm_ss_myBadges")}</Text>
          {v.my_badges.map((b) => (
            <Text key={b.season} style={styles.small}>
              {BADGE_ICON[b.badge]} {t("gm_ss_badgeLine", { y: b.season.slice(0, 4), m: Number(b.season.slice(5)), rank: b.rank, fame: b.fame })}
              {b.badge === "join" ? ` · ${t("gm_ss_join")}` : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    backgroundColor: "#0E1A2Bdd",
    borderWidth: 1,
    borderColor: "#FFFFFF44",
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  text: { color: colors.text, fontSize: 14 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  sub: { color: colors.text, fontSize: 13, fontWeight: "800" },
  warn: { color: colors.warning, fontSize: 13 },
  tabs: { flexDirection: "row", gap: space.xs, flexWrap: "wrap" },
  tab: { borderWidth: 1, borderColor: "#FFFFFF33", borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 6 },
  tabOn: { backgroundColor: "#2E6BFF55", borderColor: "#7FC8FF" },
  tabText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  small2: { borderWidth: 1, borderColor: "#FFFFFF22", borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 4 },
  tabText2: { color: colors.text, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 4, paddingHorizontal: 6, borderRadius: radius.sm },
  meRow: { backgroundColor: "#FFD16622" },
  rank: { color: "#7FC8FF", fontSize: 14, fontWeight: "900", width: 26, textAlign: "right" },
  fame: { color: "#FFD166", fontSize: 14, fontWeight: "800" },
});
