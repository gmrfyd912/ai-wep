import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Field, Screen, SectionTitle } from "@/components/ui";
import {
  addTutorCheck,
  deleteTutorCheck,
  listTutorChecks,
  runTutorCheck,
  seedTutorChecks,
  type TutorCheck,
} from "@/lib/api";
import { confirm } from "@/screens/Comments";
import { textbookError } from "@/screens/TextbookParts";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

/** 판정 → 표시 (✓ 맞음, ✗ 엉뚱한 쪽·"교재에 없다", △ 근거 쪽 없음) */
const MARK: Record<string, { sign: string; color: string; key: string }> = {
  ok: { sign: "✓", color: colors.success, key: "tc_ok" },
  wrong_page: { sign: "✗", color: colors.danger, key: "tc_wrongPage" },
  said_missing: { sign: "✗", color: colors.danger, key: "tc_saidMissing" },
  no_page: { sign: "△", color: colors.warning, key: "tc_noPage" },
};

/** 시스템관리자: 웰디 점검 — 질문과 정답 쪽을 넣어 두고 실제 웰디로 한꺼번에 물어 근거 쪽이 맞는지 본다 */
export default function TutorChecksScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const [items, setItems] = useState<TutorCheck[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [question, setQuestion] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => {
    listTutorChecks()
      .then((r) => setItems(r.items))
      .catch((e) => setError(textbookError(t, e)));
  }, [t]);
  useFocusEffect(load);

  if (user?.role !== "admin") return <Redirect href="/" />;

  const put = (c: TutorCheck) => setItems((cur) => (cur ?? []).map((x) => (x.id === c.id ? c : x)));

  const runOne = async (c: TutorCheck) => {
    setBusy(c.id);
    try {
      put(await runTutorCheck(c.id));
    } catch (e) {
      setError(textbookError(t, e));
    } finally {
      setBusy("");
    }
  };

  const runAll = async () => {
    const list = items ?? [];
    setError("");
    setProgress({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      setBusy(list[i].id);
      try {
        put(await runTutorCheck(list[i].id));
      } catch (e) {
        setError(textbookError(t, e));
      }
      setProgress({ done: i + 1, total: list.length });
    }
    setBusy("");
  };

  const add = async () => {
    const a = Number(from);
    const b = to.trim() ? Number(to) : a;
    if (!question.trim() || !a || !b || b < a) {
      setError(t("tc_bad"));
      return;
    }
    try {
      const c = await addTutorCheck(question.trim(), a, b);
      setItems((cur) => [...(cur ?? []), c]);
      setQuestion("");
      setFrom("");
      setTo("");
      setError("");
    } catch (e) {
      setError(textbookError(t, e));
    }
  };

  const seed = async () => {
    try {
      const r = await seedTutorChecks();
      setError(r.added ? "" : t("tc_seedNone"));
      load();
    } catch (e) {
      setError(textbookError(t, e));
    }
  };

  const remove = (c: TutorCheck) =>
    confirm(t("tc_deleteTitle"), c.question, t("tc_delete"), t("common_cancel"), async () => {
      try {
        await deleteTutorCheck(c.id);
        setItems((cur) => (cur ?? []).filter((x) => x.id !== c.id));
      } catch (e) {
        setError(textbookError(t, e));
      }
    });

  const ran = (items ?? []).filter((c) => c.last_verdict);
  const ok = ran.filter((c) => c.last_verdict === "ok").length;

  return (
    <Screen>
      <Body muted>{t("tc_intro")}</Body>
      <Text style={styles.legend}>{t("tc_legend")}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!items && !error ? <ActivityIndicator color={colors.primary} /> : null}

      {items ? (
        <View style={{ gap: space.sm }}>
          {ran.length ? (
            <Text style={styles.summary}>{t("tc_summary", { ok, total: ran.length })}</Text>
          ) : null}
          {progress && progress.done < progress.total ? (
            <Text style={styles.small}>{t("tc_running", { done: progress.done, total: progress.total })}</Text>
          ) : null}
          <AppButton
            label={t("tc_runAll", { n: items.length })}
            icon="play-outline"
            onPress={runAll}
            disabled={!items.length || !!busy}
          />
          {items.length === 0 ? <AppButton label={t("tc_seed")} icon="sparkles-outline" variant="secondary" onPress={seed} /> : null}
        </View>
      ) : null}

      {(items ?? []).map((c) => {
        const m = MARK[c.last_verdict];
        const open = openId === c.id;
        return (
          <Card key={c.id} onPress={() => setOpenId(open ? null : c.id)} style={{ gap: 4 }}>
            <View style={styles.row}>
              <Text style={[styles.sign, { color: m?.color ?? colors.faint }]}>{m?.sign ?? (c.last_verdict ? "!" : "·")}</Text>
              <Text style={[styles.q, { flex: 1 }]}>{c.question}</Text>
              {busy === c.id ? <ActivityIndicator color={colors.primary} /> : null}
            </View>
            <Text style={styles.small}>
              {t("tc_expect", { from: c.page_from, to: c.page_to })}
              {c.last_verdict ? ` · ${m ? t(m.key) : c.last_verdict}` : ` · ${t("tc_notRun")}`}
            </Text>
            {c.last_verdict ? (
              <Text style={styles.small}>
                {t("tc_got", { pages: c.last_pages.map((p) => `p.${p}`).join(", ") || "-" })} ·{" "}
                {t("tc_found", { pages: c.last_found.map((p) => `p.${p}`).join(", ") || "-" })}
              </Text>
            ) : null}
            {open ? (
              <View style={{ gap: space.sm, marginTop: space.xs }}>
                {c.last_reply ? <Text style={styles.reply}>{c.last_reply}</Text> : null}
                {c.note ? <Text style={styles.small}>{c.note}</Text> : null}
                <AppButton label={t("tc_runOne")} icon="play-outline" variant="secondary" onPress={() => runOne(c)} disabled={!!busy} />
                <Pressable onPress={() => remove(c)} hitSlop={8} style={{ alignSelf: "center", padding: space.sm }}>
                  <Text style={styles.danger}>{t("tc_delete")}</Text>
                </Pressable>
              </View>
            ) : null}
          </Card>
        );
      })}

      <SectionTitle>{t("tc_addTitle")}</SectionTitle>
      <Field label={t("tc_question")} value={question} onChangeText={setQuestion} placeholder={t("tc_questionPh")} />
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Field label={t("tc_from")} value={from} onChangeText={setFrom} keyboardType="number-pad" placeholder="88" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label={t("tc_to")} value={to} onChangeText={setTo} keyboardType="number-pad" placeholder="89" />
        </View>
      </View>
      <Text style={styles.small}>{t("tc_addHint")}</Text>
      <AppButton label={t("tc_add")} icon="add-outline" variant="secondary" onPress={add} />
      {items && items.length ? <AppButton label={t("tc_seed")} icon="sparkles-outline" variant="secondary" onPress={seed} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
  legend: { color: colors.faint, fontSize: 12, lineHeight: 18 },
  summary: { color: colors.text, fontSize: 16, fontWeight: "700" },
  small: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  sign: { fontSize: 18, fontWeight: "800", minWidth: 20 },
  q: { color: colors.text, fontSize: 14, fontWeight: "600" },
  reply: { color: colors.text, fontSize: 13, lineHeight: 19 },
  danger: { color: colors.danger, fontSize: 13 },
});
