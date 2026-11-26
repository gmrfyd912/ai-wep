import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Screen, SectionTitle } from "@/components/ui";
import { answerDaily, getDailyHistory, getMyDaily, reportQuestion, type DailyItem, type MyDaily } from "@/lib/api";
import { kindKey } from "@/screens/QuizBank";
import { textbookError } from "@/screens/TextbookParts";
import { colors, radius, space } from "@/theme";

const MARK = ["①", "②", "③", "④"];
const OX = ["O", "X"];

/** 오늘의 문제: 한 문제씩 풀고 바로 채점·해설, 근거 쪽으로 가기, 신고, 지난 문제 */
export default function DailyScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const [data, setData] = useState<MyDaily | null>(null);
  const [error, setError] = useState("");
  const [at, setAt] = useState(0);
  const [mine, setMine] = useState(lang !== "ko"); // 내 언어로 보기
  const [history, setHistory] = useState<{ day: string; items: DailyItem[]; done: number }[] | null>(null);

  const load = useCallback(() => {
    getMyDaily(lang)
      .then((d) => {
        setData(d);
        if (d.ready) {
          const first = d.items.findIndex((i) => !i.result);
          setAt(first < 0 ? d.items.length : first);
        }
      })
      .catch((e) => setError(textbookError(t, e)));
  }, [lang, t]);
  useFocusEffect(load);

  if (error && !data) return <Screen>{<Text style={styles.error}>{error}</Text>}</Screen>;
  if (!data) {
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} />
        <Body muted>{t("dq_loading")}</Body>
      </Screen>
    );
  }
  if (!data.ready) {
    return (
      <Screen>
        <Body muted>{t(data.reason === "no_book" ? "theory_noBook" : "dq_noQuestions")}</Body>
      </Screen>
    );
  }

  const replace = (item: DailyItem) => {
    const items = data.items.map((x) => (x.id === item.id ? item : x));
    const answered = items.filter((x) => x.result);
    setData({ ...data, items, done: answered.length, score: answered.reduce((s, x) => s + (x.result?.score ?? 0), 0) });
  };

  const finished = data.done >= data.total;
  const showHistory = async () => {
    try {
      setHistory((await getDailyHistory(lang)).days);
    } catch (e) {
      setError(textbookError(t, e));
    }
  };

  return (
    <Screen>
      <View style={styles.dots}>
        {data.items.map((it, i) => (
          <Pressable key={it.id} onPress={() => setAt(i)} style={[styles.dot, { borderColor: i === at ? colors.text : "transparent", backgroundColor: dotColor(it) }]}>
            <Text style={styles.dotText}>{i + 1}</Text>
          </Pressable>
        ))}
        <View style={{ flex: 1 }} />
        {lang !== "ko" ? (
          <Pressable onPress={() => setMine(!mine)} style={styles.langBtn} hitSlop={8}>
            <Ionicons name="language-outline" size={16} color={colors.muted} />
            <Text style={styles.small}>{mine ? t("dq_showKorean") : t("dq_showMine")}</Text>
          </Pressable>
        ) : null}
      </View>
      <Legend />

      {at < data.items.length ? (
        <QuestionCard
          key={data.items[at].id}
          item={data.items[at]}
          index={at}
          mine={mine}
          lang={lang}
          bookId={data.book_id}
          onAnswered={replace}
          onNext={() => {
            const next = data.items.findIndex((x, i) => i > at && !x.result);
            const any = data.items.findIndex((x) => !x.result);
            setAt(next >= 0 ? next : any >= 0 ? any : data.items.length);
          }}
        />
      ) : null}

      {finished ? (
        <Card style={{ gap: space.sm, alignItems: "center" }}>
          <Text style={styles.big}>{t("dq_doneTitle")}</Text>
          <Text style={styles.score}>
            {data.score} / {data.max_score}
          </Text>
          <Text style={styles.small}>{t("dq_streak", { n: Math.max(1, data.streak) })}</Text>
          {at < data.items.length ? null : <AppButton label={t("dq_review")} variant="secondary" onPress={() => setAt(0)} />}
        </Card>
      ) : null}

      <SectionTitle>{t("dq_history")}</SectionTitle>
      {history === null ? <AppButton label={t("dq_showHistory")} variant="secondary" icon="time-outline" onPress={showHistory} /> : null}
      {history && history.length === 0 ? <Body muted>{t("dq_noHistory")}</Body> : null}
      {history?.map((d) => (
        <Card key={d.day} style={{ gap: space.xs }}>
          <Text style={styles.unit}>
            {d.day} · {t("dq_dayDone", { done: d.done, total: d.items.length })}
          </Text>
          {d.items.map((it) => (
            <View key={it.id} style={styles.histRow}>
              <View style={[styles.mini, { backgroundColor: dotColor(it) }]} />
              <Text style={styles.histText} numberOfLines={2}>
                {mine && it.tr ? it.tr.question : it.question}
              </Text>
              {it.page ? (
                <Pressable onPress={() => router.push(`/book?id=${data.book_id}&page=${it.page}`)} hitSlop={8}>
                  <Text style={styles.link}>{t("dq_pageShort", { page: it.printed_page })}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </Card>
      ))}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

function dotColor(it: DailyItem) {
  const r = it.result;
  if (!r || r.graded_by === "missed") return colors.border;
  if (r.graded_by === "pending") return colors.warning;
  return r.correct ? colors.success : colors.danger;
}

function Legend() {
  const { t } = useTranslation();
  const items: [string, string][] = [
    [colors.success, t("dq_legendRight")],
    [colors.danger, t("dq_legendWrong")],
    [colors.warning, t("dq_legendPending")],
    [colors.border, t("dq_legendTodo")],
  ];
  return (
    <View style={styles.legend}>
      {items.map(([c, l]) => (
        <View key={l} style={styles.legendItem}>
          <View style={[styles.mini, { backgroundColor: c }]} />
          <Text style={styles.small}>{l}</Text>
        </View>
      ))}
    </View>
  );
}

function QuestionCard({
  item,
  index,
  mine,
  lang,
  bookId,
  onAnswered,
  onNext,
}: {
  item: DailyItem;
  index: number;
  mine: boolean;
  lang: string;
  bookId: string;
  onAnswered: (it: DailyItem) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [reported, setReported] = useState(false);
  const r = item.result;
  const q = mine && item.tr ? item.tr.question : item.question;
  const choices = mine && item.tr?.choices?.length ? item.tr.choices : item.choices;

  const send = async (answer: number | string) => {
    setBusy(true);
    setError("");
    try {
      onAnswered(await answerDaily(item.id, answer, lang));
    } catch (e) {
      setError(textbookError(t, e));
    } finally {
      setBusy(false);
    }
  };

  const doReport = async () => {
    try {
      await reportQuestion(item.id, reason.trim());
      setReported(true);
      setReporting(false);
    } catch (e) {
      setError(textbookError(t, e));
    }
  };

  const picked = r?.answer != null && (item.kind === "mc" || item.kind === "ox") ? Number(r.answer) : null;
  const typed = item.kind === "word" || item.kind === "short";
  const expl = mine && r?.tr?.explanation ? r.tr.explanation : r?.explanation;
  const model = mine && r?.tr?.model_answer ? r.tr.model_answer : r?.model_answer;

  return (
    <Card style={{ gap: space.md }}>
      <View style={styles.rowBetween}>
        <Text style={styles.tag}>
          {index + 1}. {t(kindKey[item.kind])}
        </Text>
        <Text style={styles.unit} numberOfLines={1}>
          {item.unit_title}
        </Text>
      </View>
      <Text style={styles.question}>{q}</Text>

      {item.kind === "mc"
        ? choices.map((c, i) => {
            const isRight = r && r.correct_choice === i;
            const isWrongPick = r && picked === i && !r.correct;
            return (
              <Pressable
                key={i}
                disabled={!!r || busy}
                onPress={() => send(i)}
                style={({ pressed }) => [
                  styles.choice,
                  isRight && { borderColor: colors.success, backgroundColor: "rgba(34,197,94,0.15)" },
                  isWrongPick && { borderColor: colors.danger, backgroundColor: "rgba(239,68,68,0.15)" },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={styles.choiceText}>
                  {MARK[i]} {c}
                </Text>
              </Pressable>
            );
          })
        : null}

      {item.kind === "ox" ? (
        <View style={styles.oxRow}>
          {OX.map((m, i) => {
            const isRight = r && r.correct_choice === i;
            const isWrongPick = r && picked === i && !r.correct;
            return (
              <Pressable
                key={m}
                disabled={!!r || busy}
                onPress={() => send(i)}
                style={({ pressed }) => [
                  styles.oxBtn,
                  isRight && { borderColor: colors.success, backgroundColor: "rgba(34,197,94,0.15)" },
                  isWrongPick && { borderColor: colors.danger, backgroundColor: "rgba(239,68,68,0.15)" },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.oxMark, { color: i === 0 ? colors.success : colors.danger }]}>{m}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {typed && !r ? (
        <>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline={item.kind === "short"}
            placeholder={item.kind === "word" ? t("dq_wordPh") : t("dq_shortPh")}
            placeholderTextColor={colors.faint}
            style={[styles.input, item.kind === "word" && { minHeight: 0 }]}
            maxLength={item.kind === "word" ? 200 : 1000}
            editable={!busy}
            returnKeyType={item.kind === "word" ? "done" : "default"}
          />
          <Text style={styles.small}>{t("dq_micHint")}</Text>
          <AppButton label={busy ? t("dq_grading") : t("dq_submit")} icon="checkmark-outline" onPress={() => send(text)} disabled={busy || !text.trim()} />
        </>
      ) : null}
      {busy && !typed ? <ActivityIndicator color={colors.primary} /> : null}

      {r ? (
        <View style={{ gap: space.sm }}>
          <ResultLine item={item} />
          {typed ? (
            <>
              <Text style={styles.label}>{t("dq_myAnswer")}</Text>
              <Text style={styles.body}>{r.answer}</Text>
              {r.feedback ? <Text style={styles.body}>{r.feedback}</Text> : null}
              <Text style={styles.label}>{t("dq_modelAnswer")}</Text>
              <Text style={styles.body}>{model}</Text>
            </>
          ) : null}
          {expl ? (
            <>
              <Text style={styles.label}>{t("dq_explanation")}</Text>
              <Text style={styles.body}>{expl}</Text>
            </>
          ) : null}
          {item.page ? (
            <AppButton
              label={t("dq_openPage", { page: item.printed_page })}
              icon="book-outline"
              variant="secondary"
              onPress={() => router.push(`/book?id=${bookId}&page=${item.page}`)}
            />
          ) : null}
          <AppButton label={t("dq_next")} icon="arrow-forward-outline" onPress={onNext} />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {reported ? (
        <Text style={styles.small}>{t("dq_reported")}</Text>
      ) : reporting ? (
        <View style={{ gap: space.sm }}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder={t("dq_reportPh")}
            placeholderTextColor={colors.faint}
            style={styles.input}
            maxLength={300}
          />
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <AppButton label={t("common_cancel")} variant="secondary" onPress={() => setReporting(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <AppButton label={t("dq_reportSend")} variant="danger" onPress={doReport} />
            </View>
          </View>
        </View>
      ) : (
        <Pressable onPress={() => setReporting(true)} hitSlop={8} style={styles.reportBtn}>
          <Ionicons name="flag-outline" size={14} color={colors.faint} />
          <Text style={styles.faint}>{t("dq_report")}</Text>
        </Pressable>
      )}
    </Card>
  );
}

function ResultLine({ item }: { item: DailyItem }) {
  const { t } = useTranslation();
  const r = item.result!;
  if (r.graded_by === "pending") return <Text style={[styles.result, { color: colors.warning }]}>{t("dq_pending")}</Text>;
  if (item.kind === "mc" || item.kind === "ox" || item.kind === "word") {
    const answer = item.kind === "mc" ? MARK[r.correct_choice ?? 0] : item.kind === "ox" ? OX[r.correct_choice ?? 0] : r.model_answer;
    return (
      <Text style={[styles.result, { color: r.correct ? colors.success : colors.danger }]}>
        {r.correct ? t("dq_right") : t("dq_wrong", { answer })}
        {r.graded_by === "teacher" ? `  (${t("dq_byTeacher")})` : ""}
      </Text>
    );
  }
  return (
    <Text style={[styles.result, { color: r.correct ? colors.success : colors.danger }]}>
      {t("dq_shortScore", { score: r.score })}
      {r.graded_by === "teacher" ? `  (${t("dq_byTeacher")})` : ""}
    </Text>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
  dots: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  dotText: { color: colors.text, fontWeight: "700" },
  langBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  mini: { width: 10, height: 10, borderRadius: 5 },
  small: { color: colors.muted, fontSize: 12 },
  faint: { color: colors.faint, fontSize: 12 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  tag: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  unit: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  question: { color: colors.text, fontSize: 17, lineHeight: 25, fontWeight: "600" },
  choice: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: space.md, backgroundColor: colors.cardAlt },
  choiceText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  oxRow: { flexDirection: "row", gap: space.md },
  oxBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
  },
  oxMark: { fontSize: 40, fontWeight: "800" },
  input: {
    color: colors.text,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    padding: space.md,
    minHeight: 80,
    fontSize: 15,
    textAlignVertical: "top",
  },
  label: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  result: { fontSize: 16, fontWeight: "700" },
  reportBtn: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-end" },
  big: { color: colors.text, fontSize: 17, fontWeight: "700" },
  score: { color: colors.primary, fontSize: 28, fontWeight: "800" },
  histRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  histText: { color: colors.text, fontSize: 13, flex: 1 },
  link: { color: colors.primary, fontSize: 12 },
});
