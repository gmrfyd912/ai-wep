import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Card, SectionTitle } from "@/components/ui";
import { getDailySettings, getQuizInfo, saveDailySettings, startQuiz, type DailySettings, type QuizInfo } from "@/lib/api";
import { confirm } from "@/screens/Comments";
import { ProgressBar, textbookError } from "@/screens/TextbookParts";
import { colors, radius, space } from "@/theme";

/** 관리자 교재 화면의 '문제 은행' 칸: 만들기 진행, 문제 수, 문제 보기·고치기 */
export function QuizBankSection({ bookId, ready }: { bookId: string; ready: boolean }) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<QuizInfo | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    getQuizInfo(bookId)
      .then(setInfo)
      .catch((e) => setError(textbookError(t, e)));
  }, [bookId, t]);
  useEffect(load, [load]);

  // 만드는 중이면 5초마다 진행 새로 받기
  useEffect(() => {
    if (!info?.running) return;
    const h = setTimeout(load, 5000);
    return () => clearTimeout(h);
  }, [info, load]);

  const start = async (replace: boolean) => {
    setError("");
    try {
      setInfo(await startQuiz(bookId, replace));
    } catch (e) {
      setError(textbookError(t, e));
    }
  };

  const count = info ? info.mc + info.short : 0;
  return (
    <>
      <SectionTitle>{t("qb_title")}</SectionTitle>
      <Card style={{ gap: space.sm }}>
        <Text style={styles.small}>{t("qb_intro")}</Text>
        {!info && !error ? <ActivityIndicator color={colors.primary} /> : null}
        {info ? (
          <>
            <Text style={styles.label}>{t("qb_counts", { mc: info.mc, short: info.short })}</Text>
            {info.reported ? <Text style={[styles.small, { color: colors.warning }]}>{t("qb_reportedCount", { n: info.reported })}</Text> : null}
            {info.running ? (
              <View style={{ gap: space.xs }}>
                <Text style={styles.small}>{t("qb_running", { done: info.done, total: info.total })}</Text>
                <ProgressBar ratio={info.total ? info.done / info.total : 0} />
              </View>
            ) : null}
            {!info.running && info.error ? <Text style={styles.small}>({info.error})</Text> : null}
            {!info.running ? (
              <AppButton
                label={count ? t("qb_fill") : t("qb_make")}
                icon="sparkles-outline"
                onPress={() => start(false)}
                disabled={!ready}
              />
            ) : null}
            {count ? <AppButton label={t("qb_open")} icon="list-outline" variant="secondary" onPress={() => router.push(`/manage/questions/${bookId}`)} /> : null}
            {!info.running && count ? (
              <Pressable
                onPress={() => confirm(t("qb_remakeTitle"), t("qb_remakeConfirm"), t("qb_remake"), t("common_cancel"), () => start(true))}
                hitSlop={8}
              >
                <Text style={styles.danger}>{t("qb_remake")}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.small}>{ready ? t("qb_hint") : t("tb_notReadyHint")}</Text>
          </>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>
    </>
  );
}

/** 관리자 교재 목록 화면의 '매일 문제 개수' 칸 */
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

  return (
    <>
      <SectionTitle>{t("qb_settings")}</SectionTitle>
      <Card style={{ gap: space.sm }}>
        {v ? (
          <>
            <Stepper label={t("dq_mc")} value={v.mc} min={0} max={5} onChange={(mc) => change({ ...v, mc })} />
            <Stepper label={t("dq_short")} value={v.short} min={0} max={3} onChange={(short) => change({ ...v, short })} />
            <Text style={styles.small}>{t("qb_settingsHint")}</Text>
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
  stepRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  stepLabel: { color: colors.text, fontSize: 15, flex: 1 },
  stepBtn: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.cardAlt, alignItems: "center", justifyContent: "center" },
  stepSign: { color: colors.text, fontSize: 20, fontWeight: "700" },
  stepValue: { color: colors.text, fontSize: 17, fontWeight: "700", minWidth: 24, textAlign: "center" },
});
