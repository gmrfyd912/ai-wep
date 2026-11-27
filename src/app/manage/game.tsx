import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Screen } from "@/components/ui";
import { getGameSettings, putGameSettings, type GameSettings } from "@/lib/api";
import { colors, radius, space } from "@/theme";

/** 숫자 칸 순서 (서버 game.DEFAULTS 와 같은 이름) */
const NUMBER_KEYS = [
  "daily_done_steel",
  "daily_ok_rods",
  "daily_ok_rods_short",
  "redo_tech",
  "live_ok_rods",
  "tutor_ok_tech",
  "unit_done_tech",
  "unit_pages_pct",
  "unit_correct",
  "practice_steel",
  "pass_day_max",
  "pass_high_score",
  "pass_jump",
  "welcome_steel",
  "welcome_rods",
] as const;

/** 본관 승급 시험 칸 (종류별 문제 수 + 합격 개수) */
const EXAM_KEYS = ["hq_exam_ox", "hq_exam_mc", "hq_exam_word", "hq_exam_short", "hq_exam_pass"] as const;
const ALL_KEYS = [...NUMBER_KEYS, ...EXAM_KEYS];

/** 관리자: 웰디의 조선소 게임 설정 (켜기·공부 보상 숫자·장 완료 기준) */
export default function GameSettingsScreen() {
  const { t } = useTranslation();
  const [st, setSt] = useState<GameSettings | null>(null);
  const [defaults, setDefaults] = useState<GameSettings | null>(null);
  const [text, setText] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const fill = (s: GameSettings) => {
    setSt(s);
    setText(Object.fromEntries(ALL_KEYS.map((k) => [k, String(s[k] ?? "")])));
  };

  useEffect(() => {
    getGameSettings()
      .then((r) => {
        fill(r.settings);
        setDefaults(r.defaults);
      })
      .catch(() => setMsg(t("gm_err_network")));
  }, [t]);

  const save = async (next: GameSettings) => {
    setSaving(true);
    setMsg("");
    try {
      const r = await putGameSettings(next);
      fill(r.settings);
      setMsg(t("gm_setSaved"));
    } catch {
      setMsg(t("gm_setBad"));
    } finally {
      setSaving(false);
    }
  };

  const saveNumbers = () => {
    if (!st) return;
    const next: GameSettings = { ...st };
    for (const k of ALL_KEYS) {
      const v = Number(text[k]);
      if (text[k] === "" || !Number.isFinite(v) || v < 0) {
        setMsg(t("gm_setBad"));
        return;
      }
      next[k] = Math.round(v);
    }
    const total = EXAM_KEYS.slice(0, 4).reduce((a, k) => a + Number(next[k]), 0);
    const pass = Number(next.hq_exam_pass);
    if (EXAM_KEYS.some((k) => Number(next[k]) > 20) || total < 1 || pass < 1 || pass > total) {
      setMsg(t("gm_setExamBad"));
      return;
    }
    save(next);
  };

  if (!st) {
    return <Screen>{msg ? <Body>{msg}</Body> : <ActivityIndicator color={colors.primary} />}</Screen>;
  }
  const examTotal = EXAM_KEYS.slice(0, 4).reduce((a, k) => a + (Number(text[k]) || 0), 0);
  return (
    <Screen>
      <Card>
        <View style={styles.row}>
          <Text style={styles.label}>{t("gm_setEnabled")}</Text>
          <Switch value={!!st.enabled} onValueChange={(v) => save({ ...st, enabled: v })} trackColor={{ true: colors.primary, false: colors.border }} />
        </View>
        <Text style={styles.hint}>{t("gm_setEnabledHint")}</Text>
      </Card>
      <Body muted>{t("gm_setIntro")}</Body>
      <Card style={{ gap: space.sm }}>
        {NUMBER_KEYS.map((k) => (
          <View key={k} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{t(`gm_set_${k}`)}</Text>
              {defaults ? <Text style={styles.hint}>{t("gm_setDefault", { n: String(defaults[k]) })}</Text> : null}
            </View>
            <TextInput
              style={styles.input}
              value={text[k]}
              onChangeText={(v) => setText((old) => ({ ...old, [k]: v.replace(/[^0-9]/g, "") }))}
              keyboardType="number-pad"
            />
          </View>
        ))}
      </Card>
      <Text style={styles.section}>{t("gm_setExamTitle")}</Text>
      <Body muted>{t("gm_setExamHint", { total: examTotal })}</Body>
      <Card style={{ gap: space.sm }}>
        {EXAM_KEYS.map((k) => (
          <View key={k} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{t(`gm_set_${k}`)}</Text>
              {defaults ? <Text style={styles.hint}>{t("gm_setDefault", { n: String(defaults[k]) })}</Text> : null}
            </View>
            <TextInput
              style={styles.input}
              value={text[k]}
              onChangeText={(v) => setText((old) => ({ ...old, [k]: v.replace(/[^0-9]/g, "") }))}
              keyboardType="number-pad"
            />
          </View>
        ))}
      </Card>
      {msg ? <Text style={{ color: colors.muted }}>{msg}</Text> : null}
      <AppButton label={t("common_save")} icon="save-outline" disabled={saving} onPress={saveNumbers} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingVertical: 4 },
  label: { color: colors.text, fontSize: 14 },
  section: { color: colors.text, fontSize: 16, fontWeight: "700", marginTop: space.sm },
  hint: { color: colors.muted, fontSize: 12 },
  input: {
    width: 90,
    color: colors.text,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
    textAlign: "right",
  },
});
