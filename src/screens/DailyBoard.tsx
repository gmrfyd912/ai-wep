import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Card, SectionTitle } from "@/components/ui";
import { getDailyBoard, getStudentDaily, setDailyScore, type DailyBoard, type DailyItem } from "@/lib/api";
import { ProgressBar, textbookError } from "@/screens/TextbookParts";
import { colors, radius, space } from "@/theme";

/** 교사 보드의 '오늘의 문제' 칸: 반 교육생별 응시·점수·연속 일수, 많이 틀린 장, 주관식 점수 고치기 */
export function DailyBoardSection({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const [board, setBoard] = useState<DailyBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    setFailed(false);
    getDailyBoard(courseId)
      .then(setBoard)
      .catch(() => setFailed(true));
  }, [courseId]);
  useFocusEffect(load);

  if (failed) return null; // 매일 문제 표가 아직 없으면(SQL 전) 조용히 숨김
  if (!board) return <ActivityIndicator color={colors.primary} />;

  return (
    <View style={{ gap: space.sm }}>
      <SectionTitle>{t("dq_boardTitle")}</SectionTitle>
      <Text style={styles.small}>{t("dq_boardSummary", { finished: board.summary.finished, count: board.summary.count })}</Text>
      {board.weak_units.length ? (
        <Card style={{ gap: 4 }}>
          <Text style={styles.label}>{t("dq_weakUnits")}</Text>
          {board.weak_units.map((w) => (
            <Text key={w.title} style={styles.small} numberOfLines={1}>
              • {w.title} ({t("dq_wrongCount", { n: w.wrong })})
            </Text>
          ))}
        </Card>
      ) : null}
      <Text style={styles.small}>{t("dq_boardLegend")}</Text>
      {board.students.map((s) => (
        <View key={s.id}>
          <Card onPress={() => setOpen(open === s.id ? null : s.id)} style={{ gap: 6 }}>
            <View style={styles.row}>
              <Text style={styles.name}>{s.name}</Text>
              <View style={{ flex: 1 }} />
              {s.pending ? <Text style={styles.warn}>⏳ {s.pending}</Text> : null}
              {s.streak ? <Text style={styles.small}>🔥 {s.streak}</Text> : null}
              <Text style={[styles.small, { color: s.done >= s.total ? colors.success : s.done ? colors.text : colors.faint }]}>
                {s.done >= s.total ? t("dq_scoreOf", { score: s.score, max: s.max_score }) : t("dq_dayDone", { done: s.done, total: s.total })}
              </Text>
            </View>
            <ProgressBar ratio={s.total ? s.done / s.total : 0} color={s.done >= s.total ? colors.success : colors.primary} />
            {s.weak.length ? (
              <Text style={styles.small} numberOfLines={1}>
                {t("dq_weakOf", { units: s.weak.join(", ") })}
              </Text>
            ) : null}
          </Card>
          {open === s.id ? <StudentAnswers userId={s.id} day={board.day} onChanged={load} /> : null}
        </View>
      ))}
    </View>
  );
}

function StudentAnswers({ userId, day, onChanged }: { userId: string; day: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<DailyItem[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    getStudentDaily(userId, day)
      .then((r) => setItems(r.items))
      .catch((e) => setError(textbookError(t, e)));
  }, [userId, day, t]);
  useFocusEffect(load);

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!items) return <ActivityIndicator color={colors.primary} />;
  if (!items.length) return <Text style={[styles.small, styles.indent]}>{t("dq_notStarted")}</Text>;
  return (
    <View style={[styles.indent, { gap: space.sm }]}>
      {items.map((it, i) => (
        <AnswerRow key={it.id} item={it} index={i} userId={userId} day={day} onSaved={() => (load(), onChanged())} />
      ))}
    </View>
  );
}

function AnswerRow({ item, index, userId, day, onSaved }: { item: DailyItem; index: number; userId: string; day: string; onSaved: () => void }) {
  const { t } = useTranslation();
  const r = item.result;
  const [score, setScore] = useState(r?.score == null ? "" : String(r.score));
  const [error, setError] = useState("");
  const missed = !r || r.graded_by === "missed";
  const save = async () => {
    const n = Number(score);
    if (!Number.isInteger(n) || n < 0 || n > 10) return setError(t("dq_scoreRange"));
    try {
      await setDailyScore(userId, day, item.id, n);
      onSaved();
    } catch (e) {
      setError(textbookError(t, e));
    }
  };
  return (
    <Card style={{ gap: 4 }}>
      <Text style={styles.small}>
        {index + 1}. {item.kind === "mc" ? t("dq_mc") : t("dq_short")}
        {missed
          ? ` · ${t("dq_legendTodo")}`
          : r.graded_by === "pending"
            ? ` · ${t("dq_legendPending")}`
            : ` · ${t("dq_scoreOf", { score: r.score ?? 0, max: 10 })}`}
      </Text>
      <Text style={styles.q}>{item.question}</Text>
      {!missed && item.kind === "mc" ? (
        <Text style={[styles.small, { color: r.correct ? colors.success : colors.danger }]}>
          {t("dq_pickedOf", { picked: Number(r.answer) + 1, right: (r.correct_choice ?? 0) + 1 })}
        </Text>
      ) : null}
      {!missed && item.kind === "short" ? (
        <>
          <Text style={styles.body}>“{r.answer}”</Text>
          {r.feedback ? <Text style={styles.small}>{r.feedback}</Text> : null}
          <View style={styles.row}>
            <Text style={styles.small}>{t("dq_teacherScore")}</Text>
            <TextInput value={score} onChangeText={setScore} keyboardType="number-pad" maxLength={2} style={styles.scoreInput} />
            <Text style={styles.small}>/ 10</Text>
            <View style={{ flex: 1 }}>
              <AppButton label={t("common_save")} variant="secondary" onPress={save} />
            </View>
          </View>
        </>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  small: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  label: { color: colors.text, fontSize: 13, fontWeight: "700" },
  name: { color: colors.text, fontSize: 15, fontWeight: "600" },
  warn: { color: colors.warning, fontSize: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  indent: { marginLeft: space.lg, marginTop: space.xs },
  q: { color: colors.text, fontSize: 13, lineHeight: 19 },
  body: { color: colors.text, fontSize: 13 },
  error: { color: colors.danger },
  scoreInput: {
    color: colors.text,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    width: 44,
    textAlign: "center",
    paddingVertical: 6,
    fontSize: 15,
  },
});
