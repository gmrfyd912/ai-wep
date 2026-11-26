import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, Screen } from "@/components/ui";
import { QUIZ_KINDS, deleteBankQuestion, editBankQuestion, listBankQuestions, type BankQuestion, type QuizKind } from "@/lib/api";
import { confirm } from "@/screens/Comments";
import { kindKey } from "@/screens/QuizBank";
import { textbookError } from "@/screens/TextbookParts";
import { useSession } from "@/state/session";
import { colors, radius, space } from "@/theme";

type Filter = "all" | "reported" | "hidden";
const MARK = ["①", "②", "③", "④"];
const OX = ["O", "X"];

/** 시스템관리자: 문제 은행 보기·고치기·숨기기·지우기 (신고된 문제 따로 보기) */
export default function QuestionsScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const [filter, setFilter] = useState<Filter>("all");
  const [kind, setKind] = useState<QuizKind | "">("");
  const [rows, setRows] = useState<BankQuestion[] | null>(null);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setRows(null);
    listBankQuestions(bookId, filter, kind)
      .then((r) => {
        setRows(r.items);
        setOffset(r.offset);
      })
      .catch((e) => setError(textbookError(t, e)));
  }, [bookId, filter, kind, t]);
  useEffect(load, [load]);

  if (user?.role !== "admin") return <Redirect href="/" />;

  let lastUnit = "";
  return (
    <Screen>
      <Chips<Filter>
        options={[
          { value: "all", label: t("qb_filterAll") },
          { value: "reported", label: t("qb_filterReported") },
          { value: "hidden", label: t("qb_filterHidden") },
        ]}
        value={filter}
        onChange={setFilter}
      />
      <Chips<QuizKind | "">
        options={[{ value: "", label: t("qb_filterKindAll") }, ...QUIZ_KINDS.map((k) => ({ value: k, label: t(kindKey[k]) }))]}
        value={kind}
        onChange={setKind}
      />
      <Text style={styles.small}>{t("qb_listLegend")}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!rows && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {rows && rows.length === 0 ? <Body muted>{t("qb_none")}</Body> : null}
      {rows?.map((q) => {
        const head = q.unit_title !== lastUnit ? q.unit_title : null;
        lastUnit = q.unit_title;
        return (
          <View key={q.id} style={{ gap: space.xs }}>
            {head ? <Text style={styles.unit}>{head}</Text> : null}
            {open === q.id ? (
              <Editor
                q={q}
                offset={offset}
                onDone={() => {
                  setOpen(null);
                  load();
                }}
                onError={(e) => setError(textbookError(t, e))}
              />
            ) : (
              <Card onPress={() => setOpen(q.id)} style={{ gap: 4, opacity: q.status === "hidden" ? 0.5 : 1 }}>
                <View style={styles.row}>
                  <Text style={styles.tag}>{t(kindKey[q.kind])}</Text>
                  {q.report_count ? <Text style={styles.warn}>⚑ {q.report_count}</Text> : null}
                  {q.status === "hidden" ? <Text style={styles.small}>{t("qb_hiddenTag")}</Text> : null}
                  <View style={{ flex: 1 }} />
                  {q.page ? <Text style={styles.small}>{t("dq_pageShort", { page: q.page - offset })}</Text> : null}
                </View>
                <Text style={styles.q}>{q.question}</Text>
                {q.kind === "mc" ? (
                  <Text style={styles.small}>
                    {t("qb_answerIs")} {MARK[q.answer ?? 0]} {q.choices[q.answer ?? 0]}
                  </Text>
                ) : null}
                {q.kind === "ox" ? (
                  <Text style={styles.small}>
                    {t("qb_answerIs")} {OX[q.answer ?? 0]}
                  </Text>
                ) : null}
                {q.kind === "word" ? (
                  <Text style={styles.small}>
                    {t("qb_answerIs")} {[q.model_answer, ...q.choices].join(" / ")}
                  </Text>
                ) : null}
                {q.reasons.length ? <Text style={styles.warn}>“{q.reasons.join("”, “")}”</Text> : null}
              </Card>
            )}
          </View>
        );
      })}
      <AppButton label={t("common_back")} variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}

function Editor({ q, offset, onDone, onError }: { q: BankQuestion; offset: number; onDone: () => void; onError: (e: unknown) => void }) {
  const { t } = useTranslation();
  const [question, setQuestion] = useState(q.question);
  const [choices, setChoices] = useState(q.kind === "mc" ? q.choices : []);
  const [answer, setAnswer] = useState(q.answer ?? 0);
  const [model, setModel] = useState(q.model_answer);
  const [accept, setAccept] = useState(q.kind === "word" ? q.choices.join(", ") : "");
  const [expl, setExpl] = useState(q.explanation);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onDone();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(() =>
      editBankQuestion(q.id, {
        question,
        explanation: expl,
        ...(q.kind === "mc"
          ? { choices, answer }
          : q.kind === "ox"
            ? { answer }
            : q.kind === "word"
              ? { model_answer: model, choices: accept.split(/[,，]/).map((x) => x.trim()).filter(Boolean) }
              : { model_answer: model }),
        clear_reports: true,
      }),
    );

  return (
    <Card style={{ gap: space.sm, borderColor: colors.primary, borderWidth: 1 }}>
      <Text style={styles.label}>{t("qb_question")}</Text>
      <TextInput value={question} onChangeText={setQuestion} multiline style={styles.input} maxLength={500} />
      {q.kind === "mc" ? (
        <>
          <Text style={styles.label}>{t("qb_choicesHint")}</Text>
          {choices.map((c, i) => (
            <View key={i} style={styles.row}>
              <Pressable onPress={() => setAnswer(i)} hitSlop={6} style={[styles.radio, answer === i && styles.radioOn]}>
                <Text style={styles.radioText}>{MARK[i]}</Text>
              </Pressable>
              <TextInput
                value={c}
                onChangeText={(v) => setChoices(choices.map((x, j) => (j === i ? v : x)))}
                style={[styles.input, { flex: 1, minHeight: 0 }]}
                maxLength={200}
              />
            </View>
          ))}
        </>
      ) : q.kind === "ox" ? (
        <>
          <Text style={styles.label}>{t("qb_oxAnswer")}</Text>
          <View style={styles.row}>
            {OX.map((m, i) => (
              <Pressable key={m} onPress={() => setAnswer(i)} hitSlop={6} style={[styles.radio, answer === i && styles.radioOn]}>
                <Text style={styles.radioText}>{m}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : q.kind === "word" ? (
        <>
          <Text style={styles.label}>{t("dq_modelAnswer")}</Text>
          <TextInput value={model} onChangeText={setModel} style={styles.input} maxLength={100} />
          <Text style={styles.label}>{t("qb_accept")}</Text>
          <TextInput value={accept} onChangeText={setAccept} style={styles.input} maxLength={400} />
        </>
      ) : (
        <>
          <Text style={styles.label}>{t("dq_modelAnswer")}</Text>
          <TextInput value={model} onChangeText={setModel} multiline style={styles.input} maxLength={600} />
          {q.choices.length ? <Text style={styles.small}>{t("qb_points", { points: q.choices.join(" · ") })}</Text> : null}
        </>
      )}
      <Text style={styles.label}>{t("dq_explanation")}</Text>
      <TextInput value={expl} onChangeText={setExpl} multiline style={styles.input} maxLength={600} />
      {q.page ? <Text style={styles.small}>{t("dq_pageShort", { page: q.page - offset })}</Text> : null}
      <AppButton label={t("common_save")} icon="save-outline" onPress={save} disabled={busy || !question.trim() || (q.kind === "word" && !model.trim())} />
      <AppButton
        label={q.status === "hidden" ? t("qb_show") : t("qb_hide")}
        icon={q.status === "hidden" ? "eye-outline" : "eye-off-outline"}
        variant="secondary"
        onPress={() => run(() => editBankQuestion(q.id, { status: q.status === "hidden" ? "active" : "hidden" }))}
        disabled={busy}
      />
      <AppButton label={t("common_cancel")} variant="secondary" onPress={onDone} disabled={busy} />
      <Pressable
        onPress={() => confirm(t("qb_deleteTitle"), t("qb_deleteConfirm"), t("qb_delete"), t("common_cancel"), () => run(() => deleteBankQuestion(q.id)))}
        style={{ paddingTop: space.md }}
        hitSlop={8}
      >
        <Text style={styles.danger}>{t("qb_delete")}</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  small: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger },
  unit: { color: colors.primary, fontSize: 13, fontWeight: "700", marginTop: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  tag: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  warn: { color: colors.warning, fontSize: 12 },
  q: { color: colors.text, fontSize: 14, lineHeight: 20 },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  input: { color: colors.text, backgroundColor: colors.cardAlt, borderRadius: radius.sm, padding: space.sm, fontSize: 14, minHeight: 44 },
  radio: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.cardAlt },
  radioOn: { backgroundColor: colors.success },
  radioText: { color: colors.text, fontWeight: "700" },
  danger: { color: colors.danger, fontSize: 13, textAlign: "center" },
});
