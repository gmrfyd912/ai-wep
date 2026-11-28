import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton } from "@/components/ui";
import { gameContestClaim, NetworkError, type GameContest, type GameState } from "@/lib/api";
import { colors, radius, space } from "@/theme";

const DAY = 24 * 3600 * 1000;

function daysLeft(iso: string) {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / DAY));
}

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 조선소 화면 위 가운데: 이번 주 반 대항전 한 줄 (누르면 대항전 창) */
export function ContestChip({ v, onPress }: { v: GameContest | null; onPress: () => void }) {
  const { t } = useTranslation();
  if (!v?.on || !v.ready || !v.row) return null;
  const r = v.row;
  let text: string;
  if (v.reward) text = t("gm_ct_chipReward");
  else if (r.done) text = r.won ? t("gm_ct_chipWon") : t("gm_ct_chipLost");
  else if (r.them) text = t("gm_ct_chipVs", { us: fmt(r.us.score), them: fmt(r.rival_score), d: daysLeft(r.ends_at) });
  else text = t("gm_ct_chipSolo", { us: fmt(r.us.score), goal: fmt(r.target), d: daysLeft(r.ends_at) });
  return (
    <Pressable onPress={onPress} style={[styles.chip, v.reward && { borderColor: "#FFD166" }]} hitSlop={6}>
      <Text style={styles.chipText} numberOfLines={1}>🏆 {text}</Text>
    </Pressable>
  );
}

/** 대항전 창 내용: 점수판, 내가 보탠 점수, 점수 얻는 법, 보상, 지난 기록 */
export function ContestBody({ v, setV, onState, errorText }: {
  v: GameContest | null;
  setV: (v: GameContest) => void;
  onState: (s: GameState) => void;
  errorText: (e: unknown) => string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [full, setFull] = useState(false);   // 창고 자리가 모자라다고 알려 준 뒤
  if (!v) return <Text style={styles.small}>{t("gm_ct_loading")}</Text>;
  if (!v.on) return <Text style={styles.small}>{t("gm_ct_off")}</Text>;
  if (!v.ready) return <Text style={styles.small}>{t("gm_ct_notReady")}</Text>;
  const r = v.row;
  const claim = async (force = false) => {
    if (!v.reward) return;
    setBusy(true);
    setErr("");
    try {
      const out = await gameContestClaim(v.reward.week, force);
      setV(out.contest);
      onState(out.state);
      setFull(false);
      setMsg(t("gm_ct_gotMsg2", { steel: out.got.steel, rods: out.got.rods, fame: out.got.fame }));
    } catch (e) {
      setFull(e instanceof NetworkError && e.detail?.code === "contest_full");
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const pts = v.pts;
  const prize = v.prize;
  return (
    <View style={{ gap: space.sm }}>
      {v.reward ? (
        <View style={styles.rewardBox}>
          <Text style={styles.gold}>
            {v.reward.won ? t("gm_ct_rewardWon") : t("gm_ct_rewardJoin")} · {t("gm_steel")} {v.reward.steel}
            {v.reward.rods ? ` · ${t("gm_rods")} ${v.reward.rods}` : ""}
            {v.reward.fame ? ` · ${t("gm_fame")} ${v.reward.fame}` : ""}
          </Text>
          <AppButton label={t("gm_ct_claim")} icon="gift" disabled={busy} onPress={() => claim()} />
          {err ? <Text style={styles.warn}>{err}</Text> : null}
          {full ? <AppButton label={t("gm_ct_claimForce")} variant="secondary" disabled={busy} onPress={() => claim(true)} /> : null}
        </View>
      ) : null}
      {msg ? <Text style={styles.done}>{msg}</Text> : null}
      {err && !v.reward ? <Text style={styles.warn}>{err}</Text> : null}
      {!r ? (
        <Text style={styles.small}>{t("gm_ct_noClass")}</Text>
      ) : (
        <>
          <View style={styles.board}>
            <View style={styles.side}>
              <Text style={styles.team} numberOfLines={1}>{r.us.name}</Text>
              <Text style={styles.score}>{fmt(r.us.score)}</Text>
            </View>
            <Text style={styles.vs}>{t("gm_ct_vs")}</Text>
            <View style={styles.side}>
              <Text style={styles.team} numberOfLines={1}>{r.them ? r.them.name : t("gm_ct_lastWeek")}</Text>
              <Text style={[styles.score, { color: "#FF9B7A" }]}>{fmt(r.rival_score)}</Text>
            </View>
          </View>
          {r.done ? (
            <Text style={[styles.text, { color: r.won ? "#4CD07D" : colors.muted, fontWeight: "800" }]}>
              {r.won ? t("gm_ct_won") : t("gm_ct_lost")}
            </Text>
          ) : (
            <Text style={styles.small}>
              {r.them ? t("gm_ct_endsVs", { d: daysLeft(r.ends_at) }) : r.target === null ? t("gm_ct_soloFirst", { d: daysLeft(r.ends_at) }) : t("gm_ct_endsSolo", { d: daysLeft(r.ends_at) })}
            </Text>
          )}
          <Text style={styles.text}>
            {t("gm_ct_mine", { study: r.me.study, battle: r.me.battle })}
          </Text>
          {v.caps ? <Text style={styles.small}>{t("gm_ct_caps", { study: v.caps.study, battle: v.caps.battle })}</Text> : null}
          {pts ? (
            <View style={styles.howBox}>
              <Text style={styles.small}>
                📘 {t("gm_ct_howStudy", { daily: pts.daily, ox: pts.ox, crew: pts.crew })}
              </Text>
              <Text style={styles.small}>
                ⚓ {r.them ? t("gm_ct_howBattle", { name: r.them.name, star: pts.star, pirate: pts.pirate, defend: pts.defend }) : t("gm_ct_howBattleSolo", { pirate: pts.pirate })}
              </Text>
            </View>
          ) : null}
        </>
      )}
      {prize ? <Text style={styles.small}>🎁 {t("gm_ct_prize", { steel: prize.steel, rods: prize.rods, fame: prize.fame, join: prize.join })}</Text> : null}
      {(!r || r.done) && v.next_start ? <Text style={styles.small}>{t("gm_ct_next")}</Text> : null}
      {v.history?.length ? (
        <View style={{ gap: 2 }}>
          <Text style={styles.sub}>{t("gm_ct_history")}</Text>
          {v.history.map((h) => (
            <Text key={h.week} style={styles.small}>
              {h.week.slice(5).replace("-", "/")} · {h.rival ?? t("gm_ct_lastWeek")} · {fmt(h.score)} : {fmt(h.rival_score)} ·{" "}
              <Text style={{ color: h.won ? "#4CD07D" : colors.muted, fontWeight: "700" }}>{h.won ? t("gm_ct_w") : t("gm_ct_l")}</Text>
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
    maxWidth: 360,
  },
  chipText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  text: { color: colors.text, fontSize: 14 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  sub: { color: colors.text, fontSize: 13, fontWeight: "800" },
  warn: { color: colors.warning, fontSize: 13 },
  done: { color: "#4CD07D", fontSize: 13 },
  gold: { color: "#FFD166", fontSize: 14, fontWeight: "800" },
  rewardBox: { gap: space.xs, borderWidth: 1, borderColor: "#FFD16688", borderRadius: radius.md, padding: space.sm },
  board: { flexDirection: "row", alignItems: "center", gap: space.sm },
  side: { flex: 1, alignItems: "center", backgroundColor: "#FFFFFF0D", borderRadius: radius.md, paddingVertical: space.sm },
  team: { color: colors.text, fontSize: 14, fontWeight: "700" },
  score: { color: "#7FC8FF", fontSize: 26, fontWeight: "900" },
  vs: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  howBox: { gap: 2, backgroundColor: "#FFFFFF08", borderRadius: radius.sm, padding: space.xs },
});
