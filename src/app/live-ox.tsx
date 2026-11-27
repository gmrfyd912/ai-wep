import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, Label, Screen } from "@/components/ui";
import {
  endLive,
  explainLive,
  getLiveBank,
  getLiveHistory,
  getLiveSetup,
  getLiveStatus,
  NetworkError,
  pickLive,
  startLive,
  type LiveBankItem,
  type LiveHistoryItem,
  type LiveSetup,
  type LiveTeacher,
} from "@/lib/api";
import { colors, radius, space } from "@/theme";

const COURSE_KEY = "live_ox_course";
const STATUS_MS = 2000;
type Mode = "bank" | "list" | "type";

/** T5 수업 중 돌발 OX (교사·관리자): 반 고르기 → 문제 고르기 → 보내기 → 실시간 응답 → 끝 → 웰디가 설명하기 */
export default function LiveOxScreen() {
  const { t } = useTranslation();
  const [setup, setSetup] = useState<LiveSetup | null>(null);
  const [error, setError] = useState("");
  const [courseId, setCourseId] = useState("");
  const [mode, setMode] = useState<Mode>("bank");
  const [unitKey, setUnitKey] = useState("");
  const [cand, setCand] = useState<LiveBankItem | null>(null);
  const [canMake, setCanMake] = useState(false);
  const [list, setList] = useState<LiveBankItem[] | null>(null);
  const [text, setText] = useState("");
  const [typedAnswer, setTypedAnswer] = useState<"0" | "1" | "">("");
  const [seconds, setSeconds] = useState(20);
  const [busy, setBusy] = useState(false);
  const [quiz, setQuiz] = useState<LiveTeacher | null>(null);
  const [history, setHistory] = useState<LiveHistoryItem[]>([]);
  const used = useRef<string[]>([]);

  const errText = useCallback(
    (e: unknown) => {
      const code = e instanceof NetworkError ? e.detail?.code : "";
      const known = ["live_no_question", "live_no_students", "live_no_text", "live_need_text", "live_no_book", "ai_busy", "ai_not_configured", "dq_ai_failed"];
      return code && known.includes(code) ? t(`lo_err_${code}`) : t("lo_errNetwork");
    },
    [t],
  );

  useEffect(() => {
    Promise.all([getLiveSetup(), AsyncStorage.getItem(COURSE_KEY)])
      .then(([s, saved]) => {
        setSetup(s);
        setSeconds(s.default_seconds);
        if (!s.book) setMode("type");
        const id = s.courses.find((c) => c.id === saved)?.id ?? s.courses[0]?.id ?? "";
        setCourseId(id);
        // 이미 보낸 문제가 열려 있으면 이어서 본다
        if (id && s.live[id]) getLiveStatus(s.live[id]).then((r) => setQuiz(r.quiz)).catch(() => null);
      })
      .catch((e) => setError(errText(e)));
  }, [errText]);

  const loadHistory = useCallback(() => {
    if (courseId) getLiveHistory(courseId).then((r) => setHistory(r.items)).catch(() => null);
  }, [courseId]);
  useEffect(loadHistory, [loadHistory]);

  // 실시간 현황 (끝난 뒤에도 웰디 설명을 만드는 동안은 계속)
  const quizId = quiz?.id;
  const watching = !!quiz && (quiz.phase !== "ended" || quiz.explain_status === "making");
  useEffect(() => {
    if (!quizId || !watching) return;
    const timer = setInterval(() => {
      getLiveStatus(quizId)
        .then((r) => {
          setQuiz(r.quiz);
          if (r.quiz.phase === "ended") loadHistory();
        })
        .catch(() => null);
    }, STATUS_MS);
    return () => clearInterval(timer);
  }, [quizId, watching, loadHistory]);

  const pick = useCallback(
    async (make = false) => {
      if (!courseId) return;
      setBusy(true);
      setError("");
      try {
        const r = await pickLive({ course_id: courseId, unit_key: unitKey, exclude: used.current, make });
        setCand(r.question);
        setCanMake(!!r.can_make);
        if (r.question) used.current = [...used.current, r.question.id];
      } catch (e) {
        setCand(null);
        setError(errText(e));
      } finally {
        setBusy(false);
      }
    },
    [courseId, unitKey, errText],
  );

  useEffect(() => {
    if (mode === "bank" && courseId && setup?.book) pick();
    if (mode === "list" && setup?.book) {
      setList(null);
      getLiveBank(unitKey).then((r) => setList(r.items)).catch((e) => setError(errText(e)));
    }
    // 장·방식이 바뀔 때만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, unitKey, courseId, setup?.book?.id]);

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const body =
        mode === "type"
          ? { course_id: courseId, text, answer: Number(typedAnswer), seconds }
          : { course_id: courseId, question_id: cand!.id, seconds };
      const r = await startLive(body);
      setQuiz(r.quiz);
      if (mode === "type") {
        setText("");
        setTypedAnswer("");
      }
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setQuiz(null);
    if (mode === "bank") pick();
  };

  if (!setup) {
    return (
      <Screen>
        {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
      </Screen>
    );
  }
  if (!setup.courses.length) {
    return (
      <Screen>
        <Body muted>{t("lo_noCourse")}</Body>
      </Screen>
    );
  }

  const canSend =
    !!courseId && !busy && (mode === "type" ? text.trim().length > 0 && typedAnswer !== "" : !!cand);
  const short = (title: string) => title.split("›").pop()!.trim();

  return (
    <Screen>
      <Card style={{ gap: space.sm }}>
        <Label>{t("lo_course")}</Label>
        <Chips
          options={setup.courses.map((c) => ({ value: c.id, label: c.name }))}
          value={courseId}
          onChange={(v) => {
            if (quiz && quiz.phase !== "ended") return;
            setCourseId(v);
            setQuiz(null);
            AsyncStorage.setItem(COURSE_KEY, v).catch(() => null);
          }}
        />
      </Card>

      {quiz ? (
        <LivePanel
          quiz={quiz}
          onEnd={() => endLive(quiz.id).then((r) => setQuiz(r.quiz)).catch((e) => setError(errText(e)))}
          onExplain={() => explainLive(quiz.id).then((r) => setQuiz(r.quiz)).catch((e) => setError(errText(e)))}
          onNext={next}
        />
      ) : (
        <>
          <Card style={{ gap: space.sm }}>
            <Label>{t("lo_how")}</Label>
            <Chips
              options={[
                ...(setup.book
                  ? [
                      { value: "bank" as Mode, label: t("lo_modeBank") },
                      { value: "list" as Mode, label: t("lo_modeList") },
                    ]
                  : []),
                { value: "type" as Mode, label: t("lo_modeType") },
              ]}
              value={setup.book ? mode : "type"}
              onChange={setMode}
            />
            {setup.book && mode !== "type" ? (
              <Chips
                options={[
                  { value: "", label: t("lo_allUnits") },
                  ...setup.units.map((u) => ({ value: u.unit_key, label: `${short(u.title)} (${u.ox})` })),
                ]}
                value={unitKey}
                onChange={setUnitKey}
              />
            ) : null}

            {setup.book && mode === "bank" ? (
              busy && !cand ? (
                <ActivityIndicator color={colors.primary} />
              ) : cand ? (
                <QuestionCard q={cand} />
              ) : canMake ? (
                <View style={{ gap: space.sm }}>
                  <Body muted>{t("lo_noOxInUnit")}</Body>
                  <AppButton label={t("lo_make")} icon="sparkles-outline" variant="secondary" onPress={() => pick(true)} disabled={busy} />
                </View>
              ) : null
            ) : null}
            {setup.book && mode === "bank" && cand ? (
              <AppButton label={t("lo_another")} icon="shuffle-outline" variant="secondary" onPress={() => pick()} disabled={busy} />
            ) : null}

            {setup.book && mode === "list" ? (
              list === null ? (
                <ActivityIndicator color={colors.primary} />
              ) : list.length === 0 ? (
                <Body muted>{t("lo_err_live_no_question")}</Body>
              ) : (
                list.map((q) => (
                  <Pressable key={q.id} onPress={() => setCand(q)} style={[styles.item, cand?.id === q.id && styles.itemOn]}>
                    <Text style={styles.itemText}>{q.question}</Text>
                    <Text style={styles.small}>
                      {t("lo_answerIs", { mark: q.answer === 0 ? "O" : "X" })}
                      {q.printed_page ? ` · p.${q.printed_page}` : ""}
                    </Text>
                  </Pressable>
                ))
              )
            ) : null}

            {mode === "type" || !setup.book ? (
              <View style={{ gap: space.sm }}>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  placeholder={t("lo_typeHint")}
                  placeholderTextColor={colors.faint}
                  multiline
                  maxLength={300}
                  style={styles.input}
                />
                <Label>{t("lo_typeAnswer")}</Label>
                <Chips
                  options={[
                    { value: "0" as const, label: t("lo_markO") },
                    { value: "1" as const, label: t("lo_markX") },
                  ]}
                  value={typedAnswer}
                  onChange={setTypedAnswer}
                />
                <Text style={styles.small}>{t("lo_typeNote")}</Text>
              </View>
            ) : null}
          </Card>

          <Card style={{ gap: space.sm }}>
            <Label>{t("lo_seconds")}</Label>
            <Chips
              options={setup.seconds.map((s) => ({ value: String(s), label: t("lo_sec", { n: s }) }))}
              value={String(seconds)}
              onChange={(v) => setSeconds(Number(v))}
            />
          </Card>
          <AppButton label={t("lo_send")} icon="flash-outline" onPress={send} disabled={!canSend} />
          <Text style={styles.small}>{t("lo_sendNote")}</Text>
        </>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Card style={{ gap: space.sm }}>
        <Label>{t("lo_today", { n: history.length })}</Label>
        {history.length === 0 ? <Text style={styles.small}>{t("lo_todayNone")}</Text> : null}
        {history.map((h) => (
          <View key={h.id} style={styles.histRow}>
            <Text style={styles.itemText} numberOfLines={2}>
              {h.question}
            </Text>
            <Text style={styles.small}>
              {new Date(h.started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·{" "}
              {t("lo_answerIs", { mark: h.answer === 0 ? "O" : "X" })} ·{" "}
              {h.rate == null ? t("lo_noAnswers") : t("lo_histRate", { rate: h.rate, n: h.answered, total: h.targets })}
            </Text>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

function QuestionCard({ q }: { q: LiveBankItem }) {
  const { t } = useTranslation();
  return (
    <View style={styles.cand}>
      <Text style={styles.candText}>{q.question}</Text>
      <Text style={styles.small}>
        {t("lo_answerIs", { mark: q.answer === 0 ? "O" : "X" })}
        {q.unit_title ? ` · ${q.unit_title.split("›").pop()!.trim()}` : ""}
        {q.printed_page ? ` · p.${q.printed_page}` : ""}
      </Text>
    </View>
  );
}

function LivePanel({
  quiz,
  onEnd,
  onExplain,
  onNext,
}: {
  quiz: LiveTeacher;
  onEnd: () => void;
  onExplain: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();
  const ended = quiz.phase === "ended";
  const total = Math.max(1, quiz.answered);
  const mark = quiz.answer === 0 ? "O" : "X";
  return (
    <>
      <Card style={{ gap: space.sm }}>
        <Text style={styles.phase}>
          {quiz.phase === "prep" ? t("lo_prep") : quiz.phase === "open" ? t("lo_leftT", { n: Math.ceil(quiz.left ?? 0) }) : t("lo_ended")}
        </Text>
        <Text style={styles.candText}>{quiz.question}</Text>
        <Text style={styles.count}>{t("lo_answered", { n: quiz.answered, total: quiz.targets })}</Text>
        {/* 범례: 파랑 = O 고른 사람, 빨강 = X 고른 사람. 끝나기 전에는 정답 표시 안 함 */}
        <Bar label="⭕ O" n={quiz.o} total={total} color="#3B82F6" right={ended && quiz.answer === 0} />
        <Bar label="❌ X" n={quiz.x} total={total} color={colors.danger} right={ended && quiz.answer === 1} />
        <Text style={styles.small}>{ended ? t("lo_legendEnded") : t("lo_legendOpen")}</Text>
      </Card>

      {!ended ? (
        <>
          <Card style={{ gap: 6 }}>
            <Label>{t("lo_waiting", { n: quiz.waiting.length })}</Label>
            <Text style={styles.names}>{quiz.waiting.length ? quiz.waiting.join(", ") : t("lo_allIn")}</Text>
          </Card>
          <View style={{ height: space.md }} />
          <AppButton label={t("lo_endNow")} icon="stop-circle-outline" variant="danger" onPress={onEnd} />
        </>
      ) : (
        <>
          <Card style={{ gap: 6 }}>
            <Text style={styles.result}>
              {t("lo_resultLine", { mark, rate: quiz.stats?.rate ?? 0, correct: quiz.stats?.correct ?? 0, n: quiz.stats?.answered ?? 0 })}
            </Text>
            {quiz.explanation ? <Text style={styles.itemText}>{quiz.explanation}</Text> : null}
            <Label>{t("lo_wrongNames", { n: quiz.wrong.length })}</Label>
            <Text style={styles.names}>{quiz.wrong.length ? quiz.wrong.join(", ") : "-"}</Text>
            <Label>{t("lo_missedNames", { n: quiz.waiting.length })}</Label>
            <Text style={styles.names}>{quiz.waiting.length ? quiz.waiting.join(", ") : "-"}</Text>
          </Card>
          <Card style={{ gap: space.sm }}>
            <Label>{t("lo_weldyExplain")}</Label>
            {quiz.explain ? <Text style={styles.itemText}>{quiz.explain}</Text> : null}
            {quiz.explain_status === "making" ? <ActivityIndicator color={colors.primary} /> : null}
            {quiz.explain_status === "none" || quiz.explain_status === "failed" ? (
              <>
                <Text style={styles.small}>
                  {quiz.explain_status === "failed" ? t("lo_explainFailed") : t("lo_explainHint")}
                </Text>
                <AppButton label={t("lo_explainBtn")} icon="sparkles-outline" variant="secondary" onPress={onExplain} />
              </>
            ) : null}
            {quiz.explain_status === "ready" ? <Text style={styles.small}>{t("lo_explainSent")}</Text> : null}
          </Card>
          <AppButton label={t("lo_next")} icon="flash-outline" onPress={onNext} />
        </>
      )}
    </>
  );
}

function Bar({ label, n, total, color, right }: { label: string; n: number; total: number; color: string; right: boolean }) {
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={{ flex: n / total, backgroundColor: color, borderRadius: 6 }} />
        <View style={{ flex: 1 - n / total }} />
      </View>
      <Text style={[styles.barN, right && { color: colors.success }]}>
        {n}
        {right ? " ✓" : ""}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
  small: { color: colors.muted, fontSize: 12 },
  item: { padding: space.sm, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, gap: 2 },
  itemOn: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  itemText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  cand: { padding: space.md, borderRadius: radius.md, backgroundColor: colors.cardAlt, gap: 6 },
  candText: { color: colors.text, fontSize: 17, fontWeight: "700", lineHeight: 24 },
  input: {
    minHeight: 80,
    color: colors.text,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    padding: space.sm,
    fontSize: 15,
    textAlignVertical: "top",
  },
  phase: { color: colors.primary, fontSize: 16, fontWeight: "800" },
  count: { color: colors.text, fontSize: 20, fontWeight: "800" },
  barRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  barLabel: { color: colors.text, width: 44, fontSize: 14 },
  barTrack: { flex: 1, height: 14, flexDirection: "row", backgroundColor: colors.cardAlt, borderRadius: 6, overflow: "hidden" },
  barN: { color: colors.text, width: 44, textAlign: "right", fontWeight: "700" },
  names: { color: colors.text, fontSize: 14, lineHeight: 20 },
  result: { color: colors.text, fontSize: 16, fontWeight: "700" },
  histRow: { gap: 2, paddingVertical: 4, borderTopWidth: 1, borderTopColor: colors.border },
});
