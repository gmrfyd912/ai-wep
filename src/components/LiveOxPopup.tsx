import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Image, Modal, Pressable, ScrollView, StyleSheet, Text, Vibration, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { answerLive, getLiveNow, NetworkError, type LiveNow } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors, radius, space } from "@/theme";

const POLL_MS = 3000;
const BUDDY = require("../../assets/buddy/m0.png");

/**
 * T5 수업 중 돌발 OX (교육생): 앱이 켜져 있으면 어느 화면에서든 3초마다 서버에 묻고,
 * 교사가 보낸 OX 문제가 있으면 화면 가득 띄운다. (Expo Go 는 푸시 알림이 안 돼서 앱이 열려 있을 때만)
 * 끝나면 정답·해설·반 정답률, 교사가 "웰디가 설명하기"를 누르면 웰디 설명이 다시 뜬다.
 */
export function LiveOxPopup() {
  const { user } = useSession();
  if (user?.role !== "student") return null;
  return <LiveOxPoller />;
}

function LiveOxPoller() {
  const { t, i18n } = useTranslation();
  const [quiz, setQuiz] = useState<LiveNow | null>(null);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [deadline, setDeadline] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [sending, setSending] = useState(false);
  const [lateMsg, setLateMsg] = useState(false);
  const seen = useRef<string>("");
  const active = useRef(AppState.currentState === "active");

  const poll = useCallback(async () => {
    if (!active.current) return;
    try {
      const { quiz: q } = await getLiveNow(i18n.language);
      setQuiz(q);
      if (q?.phase === "open" && q.left != null) setDeadline(Date.now() + q.left * 1000);
      if (q && q.phase === "open" && seen.current !== q.id) {
        seen.current = q.id;
        setLateMsg(false);
        Vibration.vibrate([0, 300, 150, 300]);
      }
    } catch {
      // 연결이 잠깐 끊겨도 다음 차례에 다시 묻는다
    }
  }, [i18n.language]);

  useEffect(() => {
    poll();
    const timer = setInterval(poll, POLL_MS);
    const sub = AppState.addEventListener("change", (s) => {
      active.current = s === "active";
      if (active.current) poll();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [poll]);

  const open = quiz?.phase === "open";
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [open]);

  if (!quiz) return null;
  const res = quiz.result;
  // 닫은 뒤에도 웰디 설명이 새로 오면 한 번 더 띄운다
  const key = `${quiz.id}:${quiz.phase === "ended" ? (res?.explain ? "explain" : "end") : "open"}`;
  if (closed.has(key) || (quiz.phase === "ended" && !res?.explain && closed.has(`${quiz.id}:explain`))) return null;
  const close = () => setClosed((s) => new Set(s).add(key));

  const left = open ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  const ratio = open && quiz.seconds ? Math.max(0, Math.min(1, (deadline - now) / 1000 / quiz.seconds)) : 0;
  const choose = async (a: number) => {
    if (sending || !open) return;
    setSending(true);
    setQuiz({ ...quiz, my_answer: a });
    try {
      await answerLive(quiz.id, a);
    } catch (e) {
      if (e instanceof NetworkError && e.status === 409) setLateMsg(true);
      setQuiz({ ...quiz, my_answer: quiz.my_answer });
    } finally {
      setSending(false);
    }
  };

  const question = quiz.tr || quiz.question;
  return (
    <Modal visible animationType="slide" onRequestClose={quiz.phase === "ended" ? close : () => null}>
      <SafeAreaView style={styles.wrap}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.head}>{t("lo_title")}</Text>
          {quiz.tr ? <Text style={styles.small}>{quiz.question}</Text> : null}
          <Text style={styles.question}>{question}</Text>

          {quiz.phase === "open" ? (
            <>
              <View style={styles.timer}>
                <View style={[styles.timerFill, { flex: ratio, backgroundColor: left <= 5 ? colors.danger : colors.primary }]} />
                <View style={{ flex: 1 - ratio }} />
              </View>
              <Text style={styles.left}>{t("lo_left", { n: left })}</Text>
              <View style={styles.oxRow}>
                <OxButton mark="O" picked={quiz.my_answer === 0} onPress={() => choose(0)} />
                <OxButton mark="X" picked={quiz.my_answer === 1} onPress={() => choose(1)} />
              </View>
              <Text style={styles.note}>
                {lateMsg ? t("lo_late") : quiz.my_answer != null ? t("lo_sent") : t("lo_pick")}
              </Text>
            </>
          ) : null}

          {quiz.phase === "ended" && res ? (
            <>
              <View style={[styles.verdict, { borderColor: res.correct ? colors.success : res.correct === false ? colors.danger : colors.border }]}>
                <Ionicons
                  name={res.correct ? "checkmark-circle" : res.correct === false ? "close-circle" : "remove-circle-outline"}
                  size={40}
                  color={res.correct ? colors.success : res.correct === false ? colors.danger : colors.muted}
                />
                <Text style={styles.verdictText}>
                  {res.correct ? t("lo_right") : res.correct === false ? t("lo_wrong") : t("lo_missed")}
                </Text>
                <Text style={styles.answer}>{t("lo_answer", { mark: res.answer === 0 ? "O" : "X" })}</Text>
                <Text style={styles.small}>{t("lo_classRate", { rate: res.rate, n: res.answered })}</Text>
              </View>
              {res.tr_explanation || res.explanation ? (
                <View style={styles.box}>
                  <Text style={styles.boxHead}>{t("lo_explanation")}</Text>
                  <Text style={styles.text}>{res.tr_explanation || res.explanation}</Text>
                </View>
              ) : null}
              {res.explain ? (
                <View style={[styles.box, styles.buddyBox]}>
                  <Image source={BUDDY} style={styles.buddy} resizeMode="contain" />
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.boxHead}>{t("lo_weldyExplain")}</Text>
                    <Text style={styles.text}>{res.explain}</Text>
                  </View>
                </View>
              ) : res.explain_status === "making" ? (
                <Text style={styles.small}>{t("lo_weldyMaking")}</Text>
              ) : null}
              {res.book_id && res.page ? (
                <Pressable
                  style={styles.secondary}
                  onPress={() => {
                    close();
                    router.push(`/book?id=${res.book_id}&page=${res.page}`);
                  }}
                >
                  <Ionicons name="book-outline" size={18} color={colors.text} />
                  <Text style={styles.btnText}>{t("lo_openPage", { page: res.printed_page ?? res.page })}</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.primary} onPress={close}>
                <Text style={styles.btnText}>{t("lo_close")}</Text>
              </Pressable>
            </>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function OxButton({ mark, picked, onPress }: { mark: "O" | "X"; picked: boolean; onPress: () => void }) {
  const color = mark === "O" ? "#3B82F6" : colors.danger;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.ox,
        { borderColor: color, backgroundColor: picked ? color : colors.card, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.oxText, { color: picked ? colors.text : color }]}>{mark}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  body: { padding: space.lg, gap: space.md, flexGrow: 1, justifyContent: "center" },
  head: { color: colors.primary, fontSize: 22, fontWeight: "800", textAlign: "center" },
  question: { color: colors.text, fontSize: 22, fontWeight: "700", lineHeight: 32, textAlign: "center", marginVertical: space.md },
  small: { color: colors.muted, fontSize: 13, textAlign: "center" },
  timer: { flexDirection: "row", height: 10, borderRadius: 5, backgroundColor: colors.cardAlt, overflow: "hidden" },
  timerFill: { borderRadius: 5 },
  left: { color: colors.text, fontSize: 16, fontWeight: "700", textAlign: "center" },
  oxRow: { flexDirection: "row", gap: space.lg, justifyContent: "center", marginVertical: space.md },
  ox: { flex: 1, aspectRatio: 1, maxWidth: 160, borderRadius: 999, borderWidth: 4, alignItems: "center", justifyContent: "center" },
  oxText: { fontSize: 88, fontWeight: "900" },
  note: { color: colors.muted, fontSize: 14, textAlign: "center" },
  verdict: { alignItems: "center", gap: 6, padding: space.lg, borderRadius: radius.lg, borderWidth: 2, backgroundColor: colors.card },
  verdictText: { color: colors.text, fontSize: 22, fontWeight: "800" },
  answer: { color: colors.text, fontSize: 18, fontWeight: "700" },
  box: { backgroundColor: colors.card, borderRadius: radius.md, padding: space.md, gap: 4 },
  buddyBox: { flexDirection: "row", gap: space.md, alignItems: "flex-start", borderWidth: 1, borderColor: colors.primary },
  buddy: { width: 56, height: 85 },
  boxHead: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  text: { color: colors.text, fontSize: 15, lineHeight: 22 },
  primary: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  secondary: {
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    paddingVertical: 14,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
