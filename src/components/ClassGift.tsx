import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton } from "@/components/ui";
import { gameGift, gameNeed, getGameClass, type GameClass, type GameState } from "@/lib/api";
import { colors, radius, space } from "@/theme";

type Kind = "steel" | "rods";
const RES_COLOR: Record<Kind, string> = { steel: "#9AA7B4", rods: "#E8A33D" };

/**
 * 할 일 창 아래 '우리 반 자재 지원' (G3): 같은 반 친구에게 하루 1번 강판·용접봉을 보내고(보낸 사람 기술 +),
 * '자재가 필요해요'를 누르면 그날 친구들 목록에 표시된다. 글 쓰는 칸(채팅)은 없음.
 */
export function ClassGift({ onState, errorText }: { onState: (s: GameState) => void; errorText: (e: unknown) => string }) {
  const { t } = useTranslation();
  const [v, setV] = useState<GameClass | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const errRef = useRef(errorText);
  errRef.current = errorText;
  useEffect(() => {
    getGameClass().then(setV).catch((e) => setErr(errRef.current(e)));
  }, []);
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const send = (to: string, name: string, kind: Kind) =>
    act(async () => {
      const r = await gameGift(to, kind);
      setV(r.class);
      onState(r.state);
      setPick(null);
      setMsg(t("gm_gf_sentMsg", { name, n: r.class.amount, res: t(`gm_${kind}`), tech: r.class.tech }));
    });
  const ask = (kind: Kind) => act(async () => setV((await gameNeed(kind)).class));

  if (!v) return err ? <Text style={styles.warn}>{err}</Text> : <ActivityIndicator color={colors.primary} />;
  if (!v.on) return null;
  const sentTo = v.sent ? v.members.find((m) => m.id === v.sent)?.name ?? "" : null;
  return (
    <View style={styles.box}>
      <Text style={styles.title}>{t("gm_gf_title")}</Text>
      <Text style={styles.small}>{t("gm_gf_rule", { n: v.amount, tech: v.tech })}</Text>
      {msg ? <Text style={styles.done}>{msg}</Text> : null}
      {err && !pick ? <Text style={styles.warn}>{err}</Text> : null}
      {v.got_today.map((g, i) => (
        <Text key={i} style={styles.got}>
          🎁 {t("gm_gf_got", { name: g.from, n: g.steel || g.rods, res: t(g.steel ? "gm_steel" : "gm_rods") })}
        </Text>
      ))}
      {/* 내 요청 */}
      {v.need ? (
        <Text style={styles.small}>{t("gm_gf_myNeed", { res: t(`gm_${v.need}`) })}</Text>
      ) : (
        <View style={styles.row}>
          <Text style={[styles.small, { width: "100%" }]}>{t("gm_gf_askHint")}</Text>
          {(["steel", "rods"] as Kind[]).map((k) => (
            <Pressable key={k} disabled={busy} onPress={() => ask(k)} style={[styles.chip, { borderColor: RES_COLOR[k] }]}>
              <Text style={styles.chipText}>{t("gm_gf_ask", { res: t(`gm_${k}`) })}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {sentTo !== null ? <Text style={styles.done}>{t("gm_gf_sentToday", { name: sentTo })}</Text> : null}
      {v.members.length === 0 ? <Text style={styles.small}>{t("gm_gf_noMates")}</Text> : null}
      {v.members.map((m) => (
        <View key={m.id}>
          <View style={styles.row}>
            <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
              {m.name} <Text style={styles.small}>{t("gm_sc_hq", { n: m.hq })}</Text>
            </Text>
            {m.need ? <Text style={[styles.need, { borderColor: RES_COLOR[m.need] }]}>{t("gm_gf_needs", { res: t(`gm_${m.need}`) })}</Text> : null}
            {!v.sent ? (
              <Pressable disabled={busy} onPress={() => setPick(pick === m.id ? null : m.id)} style={styles.chip}>
                <Text style={styles.chipText}>{t("gm_gf_send")}</Text>
              </Pressable>
            ) : null}
          </View>
          {pick === m.id && err ? <Text style={styles.warn}>{err}</Text> : null}
          {pick === m.id && !v.sent ? (
            <View style={[styles.row, { justifyContent: "flex-end" }]}>
              {(["steel", "rods"] as Kind[]).map((k) => (
                <AppButton key={k} variant="secondary" disabled={busy} label={t("gm_gf_sendRes", { n: v.amount, res: t(`gm_${k}`) })}
                  onPress={() => send(m.id, m.name, k)} />
              ))}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.xs, borderTopWidth: 1, borderTopColor: "#FFFFFF22", paddingTop: space.sm, marginTop: space.xs },
  title: { color: colors.text, fontSize: 15, fontWeight: "800" },
  text: { color: colors.text, fontSize: 14 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  warn: { color: colors.warning, fontSize: 13 },
  done: { color: "#4CD07D", fontSize: 13 },
  got: { color: "#FFD166", fontSize: 13, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, flexWrap: "wrap" },
  chip: { borderWidth: 1, borderColor: "#FFFFFF55", borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 5 },
  chipText: { color: colors.text, fontSize: 13, fontWeight: "700" },
  need: { color: colors.text, fontSize: 12, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
});
