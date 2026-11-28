import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Screen } from "@/components/ui";
import { gameGrant, getGamePlayer, getGamePlayers, NetworkError, type GameGrantRes, type GamePlayer, type GamePlayerView } from "@/lib/api";
import { RES_COLOR } from "@/screens/GameMap";
import { colors, radius, space } from "@/theme";

const RES: GameGrantRes[] = ["steel", "rods", "tech", "passes", "fame"];

/**
 * 관리자: 웰디의 조선소 자원 지급.
 * 계정을 찾아 고르고 강판·용접봉·기술 포인트·즉시 완료권·명성을 원하는 만큼 줌 (빼기는 앞에 -).
 * 창고 한도와 상관없이 그대로 들어가고, 지급 기록(누가·언제·메모)이 남음.
 */
export default function GameGrantScreen() {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [list, setList] = useState<GamePlayer[] | null>(null);
  const [total, setTotal] = useState(0);
  const [pv, setPv] = useState<GamePlayerView | null>(null);
  const [amt, setAmt] = useState<Record<GameGrantRes, string>>({ steel: "", rods: "", tech: "", passes: "", fame: "" });
  const [memo, setMemo] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const err = (e: unknown) => {
    if (e instanceof NetworkError && e.detail?.code) {
      const d = e.detail as Record<string, unknown>;
      const key = `gg_err_${d.code}`;
      const m = t(key, { ...d, res: typeof d.res === "string" ? t(`gm_${d.res}`) : "" });
      if (m !== key) return m;
    }
    return t("gm_err_other");
  };

  // 이름·아이디로 찾기 (입력이 멈추고 0.3초 뒤)
  useEffect(() => {
    const id = setTimeout(() => {
      getGamePlayers(q)
        .then((r) => {
          setList(r.players);
          setTotal(r.total);
        })
        .catch((e) => setMsg(err(e)));
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const pick = (p: GamePlayer) => {
    setMsg("");
    setConfirm(false);
    setPv(null);
    getGamePlayer(p.id).then(setPv).catch((e) => setMsg(err(e)));
  };

  const nums = Object.fromEntries(RES.map((k) => [k, Number(amt[k] || 0)])) as Record<GameGrantRes, number>;
  const valid = RES.every((k) => Number.isInteger(nums[k])) && RES.some((k) => nums[k] !== 0);
  const summary = RES.filter((k) => nums[k]).map((k) => `${t(`gm_${k}`)} ${nums[k] > 0 ? "+" : ""}${nums[k]}`).join(" · ");

  const send = async () => {
    if (!pv || !valid || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await gameGrant({ user_id: pv.player.id, memo, ...nums });
      setPv(r);
      setAmt({ steel: "", rods: "", tech: "", passes: "", fame: "" });
      setMemo("");
      setMsg(t("gg_done", { name: r.player.name, what: summary }));
    } catch (e) {
      setMsg(err(e));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <Screen>
      <Body muted>{t("gg_intro")}</Body>
      <Card style={{ gap: space.sm }}>
        <Text style={styles.section}>{t("gg_find")}</Text>
        <TextInput style={styles.search} value={q} onChangeText={setQ} placeholder={t("gg_findHint")} placeholderTextColor={colors.faint} autoCapitalize="none" />
        {list === null ? <ActivityIndicator color={colors.primary} /> : null}
        {list?.length === 0 ? <Text style={styles.hint}>{t("gg_none")}</Text> : null}
        {list?.map((p) => (
          <Pressable key={p.id} onPress={() => pick(p)} style={[styles.person, pv?.player.id === p.id && styles.personOn]}>
            <Text style={styles.label}>{p.name}</Text>
            <Text style={styles.hint}>
              {p.login_id}
              {p.role === "admin" ? ` · ${t("gg_admin")}` : ""}
            </Text>
          </Pressable>
        ))}
        {list && total > list.length ? <Text style={styles.hint}>{t("gg_more", { n: total })}</Text> : null}
      </Card>

      {pv ? (
        <Card style={{ gap: space.sm }}>
          <Text style={styles.section}>
            {pv.player.name} ({pv.player.login_id})
          </Text>
          <Text style={styles.hint}>{pv.started ? t("gg_hq", { n: pv.hq_level }) : t("gg_notStarted")}</Text>
          <View style={styles.resRow}>
            {RES.map((k) => (
              <View key={k} style={styles.resChip}>
                <View style={[styles.dot, { backgroundColor: RES_COLOR[k] }]} />
                <Text style={styles.label}>
                  {t(`gm_${k}`)} {pv.resources[k]}
                  {k === "steel" || k === "rods" ? <Text style={styles.hint}> /{pv.caps[k]}</Text> : null}
                </Text>
              </View>
            ))}
          </View>

          <Text style={styles.section}>{t("gg_amount")}</Text>
          <Text style={styles.hint}>{t("gg_amountHint")}</Text>
          {RES.map((k) => (
            <View key={k} style={styles.row}>
              <View style={styles.rowStart}>
                <View style={[styles.dot, { backgroundColor: RES_COLOR[k] }]} />
                <Text style={styles.label}>{t(`gm_${k}`)}</Text>
              </View>
              <TextInput
                style={styles.input}
                value={amt[k]}
                placeholder="0"
                placeholderTextColor={colors.faint}
                onChangeText={(v) => {
                  setConfirm(false);
                  setAmt((old) => ({ ...old, [k]: v.replace(/[^0-9-]/g, "").replace(/(?!^)-/g, "") }));
                }}
                keyboardType="numbers-and-punctuation"
              />
            </View>
          ))}
          <TextInput
            style={styles.search}
            value={memo}
            onChangeText={setMemo}
            placeholder={t("gg_memoHint")}
            placeholderTextColor={colors.faint}
            maxLength={100}
          />
          {confirm ? (
            <View style={styles.confirm}>
              <Text style={styles.label}>{t("gg_confirm", { name: pv.player.name, what: summary })}</Text>
              <View style={styles.row2}>
                <View style={{ flex: 1 }}>
                  <AppButton label={t("common_cancel")} variant="secondary" onPress={() => setConfirm(false)} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppButton label={t("gg_send")} icon="gift-outline" disabled={busy} onPress={send} />
                </View>
              </View>
            </View>
          ) : (
            <AppButton label={t("gg_check")} icon="gift-outline" disabled={!valid || busy} onPress={() => setConfirm(true)} />
          )}
          {msg ? <Text style={styles.msg}>{msg}</Text> : null}

          <Text style={styles.section}>{t("gg_history")}</Text>
          {pv.grants.length === 0 ? <Text style={styles.hint}>{t("gg_historyNone")}</Text> : null}
          {pv.grants.map((g, i) => (
            <View key={`${g.at}-${i}`} style={styles.hist}>
              <Text style={styles.label}>
                {RES.filter((k) => g[k]).map((k) => `${t(`gm_${k}`)} ${g[k] > 0 ? "+" : ""}${g[k]}`).join(" · ")}
              </Text>
              <Text style={styles.hint}>
                {g.at ? new Date(g.at).toLocaleString() : ""} · {g.by}
                {g.memo ? ` · ${g.memo}` : ""}
              </Text>
            </View>
          ))}
        </Card>
      ) : msg ? (
        <Text style={styles.msg}>{msg}</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { color: colors.text, fontSize: 16, fontWeight: "700" },
  label: { color: colors.text, fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12 },
  msg: { color: colors.primary, fontSize: 14 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingVertical: 2 },
  row2: { flexDirection: "row", gap: space.sm },
  rowStart: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 3 },
  resRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  resChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.cardAlt, borderRadius: radius.sm, paddingVertical: 4, paddingHorizontal: 8 },
  search: {
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  input: {
    width: 110,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    textAlign: "right",
    fontSize: 15,
  },
  person: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, gap: 2 },
  personOn: { borderColor: colors.primary, backgroundColor: colors.cardAlt },
  confirm: { gap: space.sm, borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md, padding: space.sm },
  hist: { gap: 2, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6 },
});
