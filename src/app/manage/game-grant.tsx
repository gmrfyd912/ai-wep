import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Screen } from "@/components/ui";
import {
  gameGrant,
  gamePreset,
  gamePresetUndo,
  getGamePlayer,
  getGamePlayers,
  getGamePreset,
  NetworkError,
  type GameGrantRes,
  type GamePlayer,
  type GamePlayerView,
  type GamePresetInfo,
} from "@/lib/api";
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
      {pv ? <PresetCard key={pv.player.id} pv={pv} err={err} onDone={() => getGamePlayer(pv.player.id).then(setPv).catch(() => undefined)} /> : null}
    </Screen>
  );
}

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * 조선소 한 번에 맞추기 (시험·시연용): 본관 레벨을 고르면 그 레벨에 어울리는 건물·방어 시설·땅·무기·전투함·대원으로 통째로 바꿈.
 * 자원·상선·전투 기록은 그대로. 바꾸기 전 모습은 한 벌 저장 → 되돌리기 1번.
 */
function PresetCard({ pv, err, onDone }: { pv: GamePlayerView; err: (e: unknown) => string; onDone: () => void }) {
  const { t } = useTranslation();
  const [level, setLevel] = useState(Math.max(1, pv.hq_level || 1));
  const [info, setInfo] = useState<GamePresetInfo | null>(null);
  const [ask, setAsk] = useState<"apply" | "undo" | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const id = pv.player.id;

  useEffect(() => {
    setAsk(null);
    getGamePreset(id, level).then(setInfo).catch((e) => setMsg(err(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, level]);

  const go = async (what: "apply" | "undo") => {
    setBusy(true);
    setMsg("");
    try {
      const r = what === "apply" ? await gamePreset(id, level) : await gamePresetUndo(id);
      setMsg(what === "apply" ? t("gp_done", { name: pv.player.name, n: level }) : t("gp_undone", { name: pv.player.name }));
      setInfo(r.plan ? r : await getGamePreset(id, level));
      onDone();
    } catch (e) {
      setMsg(err(e));
    } finally {
      setBusy(false);
      setAsk(null);
    }
  };

  const p = info?.plan;
  const list = (o: Record<string, number>, key: (k: string) => string) =>
    Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${t(key(k))} ${v}`).join(" · ");
  const defense = new Set(["battery", "missile", "mine", "asw", "radar", "wall"]);
  const bOf = (def: boolean) => Object.fromEntries(Object.entries(p?.buildings ?? {}).filter(([k]) => defense.has(k) === def));
  const shipCount = (p?.ships ?? []).reduce<Record<string, number>>((a, k) => ({ ...a, [k]: (a[k] ?? 0) + 1 }), {});

  return (
    <Card style={{ gap: space.sm }}>
      <Text style={styles.section}>{t("gp_title")}</Text>
      <Text style={styles.hint}>{t("gp_intro")}</Text>
      <Text style={styles.label}>{t("gp_pick")}</Text>
      <View style={styles.resRow}>
        {LEVELS.map((n) => (
          <Pressable key={n} onPress={() => setLevel(n)} style={[styles.chip, level === n && styles.personOn]}>
            <Text style={styles.label}>{t("gm_level", { n })}</Text>
          </Pressable>
        ))}
      </View>
      {!p ? <ActivityIndicator color={colors.primary} /> : (
        <View style={styles.preview}>
          <Text style={styles.label}>{t("gp_land", { n: p.grid })}</Text>
          <Text style={styles.label}>{t("gp_buildings", { list: list(bOf(false), (k) => `gm_b_${k}`), n: p.level })}</Text>
          {Object.keys(bOf(true)).length ? <Text style={styles.label}>{t("gp_defense", { list: list(bOf(true), (k) => `gm_b_${k}`) })}</Text> : null}
          {Object.keys(p.short).length ? <Text style={styles.warn}>{t("gp_short", { list: list(p.short, (k) => `gm_b_${k}`) })}</Text> : null}
          <Text style={styles.label}>{t("gp_weapons", { list: Object.keys(p.weapons).map((k) => t(`gm_w_${k}`)).join(" · ") })}</Text>
          <Text style={styles.label}>{t("gp_ships", { list: list(shipCount, (k) => `gm_ship_${k}`) || t("gm_ct_none"), n: p.level })}</Text>
          <Text style={styles.label}>
            {t("gp_crews2", { list: list(p.crews as Record<string, number>, (k) => `gm_crew_${k}`) || t("gm_ct_none"), n: p.homes.n, c: p.homes.rally })}
          </Text>
          <Text style={styles.hint}>{t("gp_keep")}</Text>
        </View>
      )}
      {ask === "apply" ? (
        <View style={styles.confirm}>
          <Text style={styles.label}>{t("gp_confirm", { name: pv.player.name, n: level })}</Text>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <AppButton label={t("common_cancel")} variant="secondary" onPress={() => setAsk(null)} />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton label={t("gp_apply")} icon="construct-outline" disabled={busy} onPress={() => go("apply")} />
            </View>
          </View>
        </View>
      ) : (
        <AppButton label={t("gp_check", { n: level })} icon="construct-outline" disabled={!p || busy} onPress={() => setAsk("apply")} />
      )}
      {info?.backup ? (
        ask === "undo" ? (
          <View style={styles.confirm}>
            <Text style={styles.label}>{t("gp_undoConfirm", { name: pv.player.name, n: info.backup.level })}</Text>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <AppButton label={t("common_cancel")} variant="secondary" onPress={() => setAsk(null)} />
              </View>
              <View style={{ flex: 1 }}>
                <AppButton label={t("gp_undo")} icon="arrow-undo-outline" variant="secondary" disabled={busy} onPress={() => go("undo")} />
              </View>
            </View>
          </View>
        ) : (
          <AppButton
            label={t("gp_undoBtn", { n: info.backup.level, at: info.backup.at ? new Date(info.backup.at).toLocaleString() : "" })}
            icon="arrow-undo-outline"
            variant="secondary"
            disabled={busy}
            onPress={() => setAsk("undo")}
          />
        )
      ) : null}
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      {info?.log.length ? <Text style={styles.section}>{t("gp_history")}</Text> : null}
      {info?.log.map((g, i) => (
        <View key={`${g.at}-${i}`} style={styles.hist}>
          <Text style={styles.label}>{g.what === "undo" ? t("gp_logUndo", { n: g.from }) : t("gp_logSet", { from: g.from, n: g.what })}</Text>
          <Text style={styles.hint}>
            {g.at ? new Date(g.at).toLocaleString() : ""} · {g.by}
          </Text>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  preview: { gap: 4, backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: space.sm },
  warn: { color: colors.warning, fontSize: 13 },
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
