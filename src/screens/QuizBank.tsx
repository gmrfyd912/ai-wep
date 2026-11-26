import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Card, Chips, SectionTitle } from "@/components/ui";
import {
  QUIZ_KINDS,
  getDailySettings,
  getQuizInfo,
  saveDailySettings,
  startQuiz,
  type DailySettings,
  type KindCounts,
  type QuizInfo,
  type QuizKind,
} from "@/lib/api";
import { confirm } from "@/screens/Comments";
import { ProgressBar, textbookError } from "@/screens/TextbookParts";
import { colors, radius, space } from "@/theme";

/** 문제 종류 이름 (OX / 객관식 / 단답형 / 서술형) */
export const kindKey: Record<QuizKind, string> = { ox: "dq_ox", mc: "dq_mc", word: "dq_word", short: "dq_short" };
const DAILY_MAX: KindCounts = { ox: 5, mc: 5, word: 3, short: 2 };
const DAILY_TOTAL_MAX = 8;

type Mode = "units" | "pages";

/** 문제 은행 화면의 한 교재: 종류별 문제 수, AI 문제 만들기(범위·종류별 개수), 문제 보기·고치기 */
export function QuizBankSection({ bookId, ready }: { bookId: string; ready: boolean }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<QuizInfo | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("units");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [counts, setCounts] = useState<KindCounts | null>(null);

  const load = useCallback(() => {
    getQuizInfo(bookId)
      .then((v) => {
        setInfo(v);
        setCounts((c) => c ?? v.per_unit_default);
      })
      .catch((e) => setError(textbookError(t, e)));
  }, [bookId, t]);
  useEffect(() => {
    setInfo(null);
    setPicked(new Set());
    setFrom("");
    setTo("");
    setError("");
    load();
  }, [load]);

  // 만드는 중이면 5초마다 진행 새로 받기
  useEffect(() => {
    if (!info?.running) return;
    const h = setTimeout(load, 5000);
    return () => clearTimeout(h);
  }, [info, load]);

  if (!info || !counts) {
    return error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />;
  }

  const total = QUIZ_KINDS.reduce((s, k) => s + info[k], 0);
  const per = QUIZ_KINDS.reduce((s, k) => s + counts[k], 0);
  const pf = Number(from);
  const pt = Number(to);
  const pagesOk = mode === "pages" && from.trim() !== "" && to.trim() !== "" && pf > 0 && pt > 0;
  const nUnits =
    mode === "units"
      ? picked.size
      : pagesOk
        ? info.units.filter((u) => u.printed_start <= Math.max(pf, pt) && u.printed_end >= Math.min(pf, pt)).length
        : 0;
  const canMake = ready && !info.running && per > 0 && nUnits > 0;

  const start = async (replace: boolean) => {
    setError("");
    try {
      const range = mode === "units" ? { units: [...picked] } : { page_from: pf, page_to: pt };
      setInfo(await startQuiz(bookId, { ...range, counts, replace }));
    } catch (e) {
      setError(textbookError(t, e));
    }
  };
  const toggle = (k: string) =>
    setPicked((old) => {
      const n = new Set(old);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const first = info.units[0];
  const last = info.units[info.units.length - 1];

  return (
    <>
      <Card style={{ gap: space.sm }}>
        <Text style={styles.label}>{t("qb_countsAll", { ox: info.ox, mc: info.mc, word: info.word, short: info.short })}</Text>
        {info.reported ? <Text style={[styles.small, { color: colors.warning }]}>{t("qb_reportedCount", { n: info.reported })}</Text> : null}
        {info.running ? (
          <View style={{ gap: space.xs }}>
            <Text style={styles.small}>{t("qb_running", { done: info.done, total: info.total })}</Text>
            <ProgressBar ratio={info.total ? info.done / info.total : 0} />
          </View>
        ) : null}
        {!info.running && info.error ? <Text style={styles.small}>({info.error})</Text> : null}
        <AppButton
          label={t("qb_open")}
          icon="list-outline"
          variant="secondary"
          onPress={() => router.push(`/manage/questions/${bookId}`)}
          disabled={total === 0 && !info.hidden}
        />
      </Card>

      <SectionTitle>{t("qb_makeTitle")}</SectionTitle>
      <Card style={{ gap: space.md }}>
        {info.units.length === 0 ? (
          <Text style={styles.small}>{t("qb_noUnits")}</Text>
        ) : (
          <>
            <Chips<Mode>
              options={[
                { value: "units", label: t("qb_modeUnits") },
                { value: "pages", label: t("qb_modePages") },
              ]}
              value={mode}
              onChange={setMode}
            />
            {mode === "units" ? (
              <View style={{ gap: space.xs }}>
                <Text style={styles.small}>{t("qb_unitLegend")}</Text>
                <View style={styles.row}>
                  <Pressable onPress={() => setPicked(new Set(info.units.map((u) => u.key)))} hitSlop={6}>
                    <Text style={styles.link}>{t("qb_selectAll")}</Text>
                  </Pressable>
                  <Pressable onPress={() => setPicked(new Set())} hitSlop={6}>
                    <Text style={styles.link}>{t("qb_selectNone")}</Text>
                  </Pressable>
                </View>
                {info.units.map((u) => {
                  const on = picked.has(u.key);
                  return (
                    <Pressable key={u.key} onPress={() => toggle(u.key)} style={({ pressed }) => [styles.unitRow, pressed && { opacity: 0.6 }]}>
                      <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? colors.primary : colors.faint} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.unitTitle} numberOfLines={2}>
                          {u.title}
                        </Text>
                        <Text style={styles.small}>
                          {t("qb_unitPages", { from: u.printed_start, to: u.printed_end })} · {t("qb_unitCounts", u.counts)}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={{ gap: space.sm }}>
                <View style={styles.row}>
                  <Text style={styles.small}>{t("qb_pageFrom")}</Text>
                  <TextInput value={from} onChangeText={setFrom} keyboardType="number-pad" maxLength={4} style={styles.pageInput} placeholder={String(first?.printed_start ?? "")} placeholderTextColor={colors.faint} />
                  <Text style={styles.small}>~</Text>
                  <Text style={styles.small}>{t("qb_pageTo")}</Text>
                  <TextInput value={to} onChangeText={setTo} keyboardType="number-pad" maxLength={4} style={styles.pageInput} placeholder={String(last?.printed_end ?? "")} placeholderTextColor={colors.faint} />
                </View>
                <Text style={styles.small}>{t("qb_pagesHint", { from: first?.printed_start, to: last?.printed_end })}</Text>
              </View>
            )}

            <Text style={styles.label}>{t("qb_perUnit")}</Text>
            {QUIZ_KINDS.map((k) => (
              <Stepper key={k} label={t(kindKey[k])} value={counts[k]} min={0} max={info.per_unit_max[k]} onChange={(v) => setCounts({ ...counts, [k]: v })} />
            ))}
            <Text style={styles.small}>{t("qb_estimate", { units: nUnits, per, total: nUnits * per })}</Text>
            {!info.running ? (
              <AppButton label={t("qb_makeBtn")} icon="sparkles-outline" onPress={() => start(false)} disabled={!canMake} />
            ) : null}
            {nUnits === 0 && !info.running ? <Text style={styles.small}>{t("qb_needRange")}</Text> : null}
            {!ready ? <Text style={styles.small}>{t("tb_notReadyHint")}</Text> : null}
            {!info.running && canMake ? (
              <Pressable
                onPress={() => confirm(t("qb_replaceTitle"), t("qb_replaceConfirm"), t("qb_replaceBtn"), t("common_cancel"), () => start(true))}
                hitSlop={8}
                style={{ paddingTop: space.sm }}
              >
                <Text style={styles.danger}>{t("qb_replaceBtn")}</Text>
              </Pressable>
            ) : null}
          </>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
    </>
  );
}

/** 문제 은행 화면의 '매일 문제 개수' 칸 (종류 4가지) */
export function DailySettingsCard() {
  const { t } = useTranslation();
  const [v, setV] = useState<DailySettings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    getDailySettings()
      .then(setV)
      .catch((e) => setError(textbookError(t, e)));
  }, [t]);

  const change = async (next: DailySettings) => {
    const before = v;
    setV(next);
    setError("");
    try {
      setV(await saveDailySettings(next));
    } catch (e) {
      setV(before);
      setError(textbookError(t, e));
    }
  };
  const sum = v ? QUIZ_KINDS.reduce((s, k) => s + v[k], 0) : 0;

  return (
    <>
      <SectionTitle>{t("qb_settings")}</SectionTitle>
      <Card style={{ gap: space.sm }}>
        {v ? (
          <>
            {QUIZ_KINDS.map((k) => (
              <Stepper
                key={k}
                label={t(kindKey[k])}
                value={v[k]}
                min={0}
                max={Math.min(DAILY_MAX[k], v[k] + DAILY_TOTAL_MAX - sum)}
                onChange={(n) => (sum - v[k] + n >= 1 ? change({ ...v, [k]: n }) : undefined)}
              />
            ))}
            <Text style={styles.small}>{t("qb_settingsHint", { n: sum })}</Text>
          </>
        ) : !error ? (
          <ActivityIndicator color={colors.primary} />
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
    </>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <View style={styles.stepRow}>
      <Text style={styles.stepLabel}>{label}</Text>
      <Pressable onPress={() => value > min && onChange(value - 1)} style={styles.stepBtn} disabled={value <= min} hitSlop={6}>
        <Text style={[styles.stepSign, value <= min && { color: colors.faint }]}>−</Text>
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable onPress={() => value < max && onChange(value + 1)} style={styles.stepBtn} disabled={value >= max} hitSlop={6}>
        <Text style={[styles.stepSign, value >= max && { color: colors.faint }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  small: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  label: { color: colors.text, fontSize: 15, fontWeight: "600" },
  error: { color: colors.danger },
  danger: { color: colors.danger, fontSize: 13, textAlign: "center", paddingVertical: 4 },
  link: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  unitRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 6 },
  unitTitle: { color: colors.text, fontSize: 14 },
  pageInput: {
    color: colors.text,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    width: 64,
    textAlign: "center",
    paddingVertical: 6,
    fontSize: 15,
  },
  stepRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  stepLabel: { color: colors.text, fontSize: 15, flex: 1 },
  stepBtn: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.cardAlt, alignItems: "center", justifyContent: "center" },
  stepSign: { color: colors.text, fontSize: 20, fontWeight: "700" },
  stepValue: { color: colors.text, fontSize: 17, fontWeight: "700", minWidth: 24, textAlign: "center" },
});
