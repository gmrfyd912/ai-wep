import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
  type TextInputInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { StudyBuddy } from "@/components/StudyBuddy";
import { answerTutorQuiz, askTutor, reportTutor, type DailyItem, type TutorReply, type TutorTurn } from "@/lib/api";
import { textbookError } from "@/screens/TextbookParts";
import { useSession } from "@/state/session";
import { colors, radius, space } from "@/theme";

const AUTO_KEY = "tutor_auto"; // 말이 멈추면 자동으로 보내기
const FOLLOW_KEY = "tutor_follow"; // 대답 뒤 이어 듣기
const QUIET_MS = 1500; // 받아쓴 글자가 이만큼 안 바뀌면 말이 끝난 것으로 본다
const FOLLOW_S = 8; // 대답 뒤 이어 말하기를 기다리는 시간
const MARK = ["①", "②", "③", "④"];
const OX = ["O", "X"];
/** 말 끝에 붙이면 바로 보내는 말 */
const END_RE = /\s*(끝|다\s*했어요?|다했어요?|이상입니다|over|done|that'?s all|selesai|xong|tamom|listo|tapos na|เสร็จแล้ว)[.!?。\s]*$/i;
/** 이 말만 하면 대화를 끝낸다 */
const CLOSE_RE =
  /^\s*(고마워요?|고맙습니다|감사합니다|감사해요|그만(해|할게|하자)?|됐어요?|thanks?( you)?|thank you|bye|stop|cảm ơn|terima kasih|rahmat|gracias|salamat|ขอบคุณ(ครับ|ค่ะ)?)[.!?\s]*$/i;

type Msg = {
  n: number;
  who: "me" | "buddy";
  text: string;
  res?: TutorReply;
  quiz?: DailyItem;
  reported?: boolean;
};
type Phase = "ready" | "thinking" | "speaking" | "follow" | "closed";

/** AI 학습 보조 '웰디'와 대화: 자판 마이크로 말하면 받아쓴 글자가 1.5초 멈출 때 자동으로 보낸다 */
export default function TutorScreen() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const { user } = useSession();
  const params = useLocalSearchParams<{ page?: string }>();
  const ctxPage = params.page ? Number(params.page) || undefined : undefined;

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [line, setLine] = useState(t("tutor_hello", { name: user?.name ?? "" }));
  const [nonce, setNonce] = useState(0);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("speaking");
  const [auto, setAuto] = useState(true);
  const [follow, setFollow] = useState(true);
  const [left, setLeft] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [kb, setKb] = useState(0);

  const input = useRef<TextInputInstance | null>(null);
  const list = useRef<ScrollViewInstance | null>(null);
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const dictating = useRef(false); // 받아쓰기처럼 글자가 한꺼번에 들어오면 true (손으로 칠 때는 자동으로 안 보냄)
  const counter = useRef(0);
  // 처음 인사가 끝나면 그냥 듣기 상태로 (8초 기다리기 없음)
  const afterSpeak = useRef<null | (() => void)>(() => setPhase("ready"));
  const textRef = useRef("");

  useEffect(() => {
    AsyncStorage.multiGet([AUTO_KEY, FOLLOW_KEY]).then(([[, a], [, f]]) => {
      setAuto(a !== "off");
      setFollow(f !== "off");
    });
    const show = Keyboard.addListener("keyboardDidShow", (e) => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKb(0));
    return () => {
      show.remove();
      hide.remove();
      stopTimers();
      Speech.stop();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopTimers = () => {
    if (quiet.current) clearTimeout(quiet.current);
    if (tick.current) clearInterval(tick.current);
    quiet.current = null;
    tick.current = null;
    setCountdown(0);
  };

  const say = useCallback((s: string, then?: () => void) => {
    afterSpeak.current = then ?? null;
    setLine(s);
    setNonce((n) => n + 1);
    setPhase("speaking");
  }, []);

  const push = (m: Omit<Msg, "n">) => {
    counter.current += 1;
    const n = counter.current;
    setMsgs((cur) => [...cur, { ...m, n }]);
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 80);
    return n;
  };

  const listen = () => {
    stopTimers();
    setPhase("ready");
    input.current?.focus();
  };

  /** 대답을 다 말한 뒤: 이어 듣기가 켜져 있으면 8초 동안 기다린다 */
  const onSpoken = () => {
    const then = afterSpeak.current;
    afterSpeak.current = null;
    if (then) return then();
    if (!follow) {
      setPhase("closed");
      Keyboard.dismiss();
      return;
    }
    setPhase("follow");
    input.current?.focus();
    let s = FOLLOW_S;
    setCountdown(s);
    if (tick.current) clearInterval(tick.current);
    tick.current = setInterval(() => {
      s -= 1;
      setCountdown(s);
      if (s <= 0) {
        stopTimers();
        if (!textRef.current.trim()) {
          setPhase("closed");
          Keyboard.dismiss();
        }
      }
    }, 1000);
  };

  const history = (): TutorTurn[] => {
    const out: TutorTurn[] = [];
    for (let i = 0; i < msgs.length - 1; i++) {
      const a = msgs[i + 1];
      if (msgs[i].who === "me" && a.who === "buddy" && a.res?.reply) out.push({ q: msgs[i].text, a: a.res.reply });
    }
    return out.slice(-3);
  };

  const replyText = (r: TutorReply) => r.reply || t(r.key ?? "tutor_aiFailed", r.params);

  const send = async (raw: string) => {
    stopTimers();
    dictating.current = false;
    const q = raw.replace(END_RE, "").trim();
    setText("");
    textRef.current = "";
    if (!q) return;
    push({ who: "me", text: q });
    if (CLOSE_RE.test(q)) {
      push({ who: "buddy", text: t("tutor_bye") });
      Keyboard.dismiss();
      say(t("tutor_bye"), () => setPhase("closed"));
      return;
    }
    Speech.stop();
    Keyboard.dismiss();
    setPhase("thinking");
    try {
      const r = await askTutor(q, lang, history(), ctxPage);
      if (r.left !== null) setLeft(r.left);
      const s = replyText(r);
      push({ who: "buddy", text: s, res: r, quiz: r.quiz ?? undefined });
      const spoken = r.quiz ? `${s} ${quizText(r.quiz, lang)}` : s;
      if (r.open && !r.reply && r.book_id) {
        // "3장 보여줘" → 말하고 바로 교재를 연다
        const bookId = r.book_id;
        const page = r.open.page;
        say(s, () => {
          setPhase("closed");
          router.push(`/book?id=${bookId}&page=${page}`);
        });
      } else if (r.quiz) {
        say(spoken, () => setPhase("closed")); // 문제는 보기를 누르는 동안 기다린다
      } else {
        say(spoken);
      }
    } catch (e) {
      const s = textbookError(t, e);
      push({ who: "buddy", text: s });
      say(s);
    }
  };

  const onChange = (v: string) => {
    if (phase === "speaking") {
      // 웰디가 말하는 중에 말하기 시작하면 웰디 목소리를 멈춘다 (받아쓰기에 섞이지 않게)
      Speech.stop();
      afterSpeak.current = null;
    }
    const added = v.length - textRef.current.length;
    if (added >= 2) dictating.current = true; // 받아쓰기는 낱말째 들어온다
    textRef.current = v;
    setText(v);
    if (tick.current) {
      clearInterval(tick.current);
      tick.current = null;
      setCountdown(0);
    }
    if (phase !== "ready" && phase !== "thinking") setPhase("ready");
    if (quiet.current) clearTimeout(quiet.current);
    if (!v.trim()) return;
    if (END_RE.test(v) && v.replace(END_RE, "").trim()) {
      send(v);
      return;
    }
    if (auto && dictating.current) quiet.current = setTimeout(() => send(textRef.current), QUIET_MS);
  };

  /** 캐릭터 누르기: 말하는 중이면 멈추고, 쓴 말이 있으면 바로 보내고, 아니면 듣기 시작 */
  const tapBuddy = () => {
    if (phase === "speaking") {
      Speech.stop();
      afterSpeak.current = null;
      listen();
      return;
    }
    if (phase === "thinking") return;
    if (text.trim()) send(text);
    else listen();
  };

  const toggle = (key: string, v: boolean, set: (b: boolean) => void) => {
    set(v);
    AsyncStorage.setItem(key, v ? "on" : "off");
  };

  const pick = async (m: Msg, choice: number) => {
    if (!m.quiz || m.quiz.result) return;
    try {
      const r = await answerTutorQuiz(m.quiz.id, choice, lang);
      setMsgs((cur) => cur.map((x) => (x.n === m.n ? { ...x, quiz: r } : x)));
      const res = r.result!;
      const mine = lang !== "ko" && res.tr ? res.tr.explanation : res.explanation;
      const right = res.correct_choice ?? 0;
      const head = res.correct
        ? t("dq_right")
        : t("dq_wrong", { answer: r.kind === "ox" ? OX[right] : `${MARK[right]} ${choicesOf(r, lang)[right] ?? ""}` });
      say(`${head} ${mine}`.trim());
    } catch (e) {
      say(textbookError(t, e));
    }
  };

  const report = async (m: Msg) => {
    if (!m.res?.id || m.reported) return;
    try {
      await reportTutor(m.res.id);
      setMsgs((cur) => cur.map((x) => (x.n === m.n ? { ...x, reported: true } : x)));
    } catch {
      // 신고가 안 되면 그대로 둔다
    }
  };

  const openPage = (bookId: string | null, page: number) => {
    if (!bookId) return;
    Speech.stop();
    stopTimers();
    router.push(`/book?id=${bookId}&page=${page}`);
  };

  const status =
    phase === "thinking"
      ? t("tutor_thinking")
      : phase === "follow" && countdown > 0
        ? t("tutor_follow", { n: countdown })
        : phase === "closed"
          ? t("tutor_closed")
          : phase === "speaking"
            ? t("tutor_speaking")
            : t("tutor_listen");

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={[styles.root, kb ? { paddingBottom: kb } : null]}>
      <View style={styles.top}>
        <StudyBuddy text={line} nonce={nonce} onPress={tapBuddy} onDone={onSpoken} hint={t("tutor_tapHint")} size={kb ? 64 : 92} />
      </View>

      <ScrollView ref={list} style={{ flex: 1 }} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {msgs.length === 0 ? <Text style={styles.examples}>{t("tutor_examples")}</Text> : null}
        {msgs.map((m) =>
          m.who === "me" ? (
            <View key={m.n} style={styles.meRow}>
              <Text style={styles.meText}>{m.text}</Text>
            </View>
          ) : (
            <View key={m.n} style={styles.buddyBox}>
              <Text style={styles.buddyText}>{m.text}</Text>
              {m.res?.outside ? <Text style={styles.outside}>{t("tutor_outside")}</Text> : null}
              {m.quiz ? <QuizCard item={m.quiz} lang={lang} onPick={(c) => pick(m, c)} /> : null}
              <View style={styles.chipRow}>
                {(m.res?.pages ?? []).map((p) => (
                  <Pressable key={p.page} style={styles.chip} onPress={() => openPage(m.res!.book_id, p.page)}>
                    <Ionicons name="book-outline" size={13} color={colors.primary} />
                    <Text style={styles.chipText}>p.{p.printed}</Text>
                  </Pressable>
                ))}
                {m.res?.open ? (
                  <Pressable style={styles.chip} onPress={() => openPage(m.res!.book_id, m.res!.open!.page)}>
                    <Ionicons name="open-outline" size={13} color={colors.primary} />
                    <Text style={styles.chipText}>{t("tutor_openBtn", { page: m.res.open.printed })}</Text>
                  </Pressable>
                ) : null}
                {m.res?.reply && m.res.id ? (
                  <Pressable style={styles.flag} onPress={() => report(m)} hitSlop={8} disabled={m.reported}>
                    <Ionicons name={m.reported ? "flag" : "flag-outline"} size={13} color={m.reported ? colors.warning : colors.faint} />
                    <Text style={[styles.flagText, m.reported && { color: colors.warning }]}>
                      {m.reported ? t("tutor_reported") : t("tutor_report")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ),
        )}
        {phase === "thinking" ? <ActivityIndicator color={colors.primary} style={{ alignSelf: "flex-start" }} /> : null}
      </ScrollView>

      <View style={styles.bottom}>
        <View style={styles.statusRow}>
          <Text style={[styles.status, phase === "follow" && { color: colors.primary }]} numberOfLines={1}>
            {status}
          </Text>
          {left !== null && left <= 10 ? <Text style={styles.small}>{t("tutor_left", { n: left })}</Text> : null}
        </View>
        <View style={styles.inputRow}>
          <TextInput
            ref={input}
            value={text}
            onChangeText={onChange}
            placeholder={t("tutor_ph")}
            placeholderTextColor={colors.faint}
            style={styles.input}
            multiline
            autoFocus
            editable={phase !== "thinking"}
            onFocus={() => {
              if (phase === "closed") setPhase("ready");
            }}
          />
          <Pressable
            onPress={() => send(text)}
            disabled={!text.trim() || phase === "thinking"}
            style={[styles.sendBtn, (!text.trim() || phase === "thinking") && { opacity: 0.4 }]}
            accessibilityLabel={t("tutor_send")}
          >
            <Ionicons name="arrow-up" size={20} color={colors.text} />
          </Pressable>
        </View>
        <Text style={styles.micHint}>{t("tutor_micHint")}</Text>
        <View style={styles.toggles}>
          <Toggle label={t("tutor_autoSend")} on={auto} onPress={() => toggle(AUTO_KEY, !auto, setAuto)} />
          <Toggle label={t("tutor_followOn")} on={follow} onPress={() => toggle(FOLLOW_KEY, !follow, setFollow)} />
        </View>
        {kb ? null : <Text style={styles.legend}>{t("tutor_legend")}</Text>}
      </View>
    </SafeAreaView>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.toggle, on && styles.toggleOn]} hitSlop={6}>
      <Ionicons name={on ? "checkbox" : "square-outline"} size={15} color={on ? colors.primary : colors.faint} />
      <Text style={[styles.toggleText, on && { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const questionOf = (q: DailyItem, lang: string) => (lang !== "ko" && q.tr ? q.tr.question : q.question);
const choicesOf = (q: DailyItem, lang: string) => (lang !== "ko" && q.tr?.choices?.length ? q.tr.choices : q.choices);
const quizText = (q: DailyItem, lang: string) => questionOf(q, lang);

function QuizCard({ item, lang, onPick }: { item: DailyItem; lang: string; onPick: (c: number) => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const res = item.result;
  const choose = (c: number) => {
    if (busy || res) return;
    setBusy(true);
    onPick(c);
  };
  const tone = (i: number) => {
    if (!res) return null;
    if (i === res.correct_choice) return styles.optRight;
    if (String(i) === res.answer) return styles.optWrong;
    return null;
  };
  const explanation = res ? (lang !== "ko" && res.tr ? res.tr.explanation : res.explanation) : "";
  return (
    <View style={styles.quiz}>
      <Text style={styles.quizKind}>
        {item.kind === "ox" ? t("dq_ox") : t("dq_mc")} · {t("tutor_practice")}
      </Text>
      <Text style={styles.quizQ}>{questionOf(item, lang)}</Text>
      {item.kind === "ox" ? (
        <View style={styles.oxRow}>
          {OX.map((o, i) => (
            <Pressable key={o} style={[styles.oxBtn, tone(i)]} onPress={() => choose(i)} disabled={!!res}>
              <Text style={styles.oxText}>{o}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        choicesOf(item, lang).map((c, i) => (
          <Pressable key={i} style={[styles.opt, tone(i)]} onPress={() => choose(i)} disabled={!!res}>
            <Text style={styles.optText}>
              {MARK[i]} {c}
            </Text>
          </Pressable>
        ))
      )}
      {res ? (
        <Text style={[styles.quizRes, { color: res.correct ? colors.success : colors.danger }]}>
          {res.correct ? t("dq_right") : t("dq_legendWrong")}
          {explanation ? ` · ${explanation}` : ""}
        </Text>
      ) : busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xs, backgroundColor: colors.card },
  list: { padding: space.lg, gap: space.sm },
  examples: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  meRow: { alignSelf: "flex-end", maxWidth: "85%", backgroundColor: colors.primaryDim, borderRadius: radius.md, borderBottomRightRadius: 2, padding: space.md },
  meText: { color: colors.text, fontSize: 15 },
  buddyBox: { alignSelf: "flex-start", maxWidth: "92%", backgroundColor: colors.cardAlt, borderRadius: radius.md, borderBottomLeftRadius: 2, padding: space.md, gap: space.sm },
  buddyText: { color: colors.text, fontSize: 15, lineHeight: 22 },
  outside: { color: colors.warning, fontSize: 12 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.sm },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  flag: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: "auto" },
  flagText: { color: colors.faint, fontSize: 11 },
  bottom: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.card, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.sm, gap: 6 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  status: { color: colors.muted, fontSize: 12, flex: 1 },
  small: { color: colors.muted, fontSize: 12 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  input: { flex: 1, color: colors.text, backgroundColor: colors.cardAlt, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 10, fontSize: 16, maxHeight: 110 },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  micHint: { color: colors.faint, fontSize: 11 },
  toggles: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  toggle: { flexDirection: "row", alignItems: "center", gap: 4 },
  toggleOn: {},
  toggleText: { color: colors.muted, fontSize: 12 },
  legend: { color: colors.faint, fontSize: 11, lineHeight: 16 },
  quiz: { gap: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: space.sm },
  quizKind: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  quizQ: { color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: "600" },
  oxRow: { flexDirection: "row", gap: space.md },
  oxBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: space.md, alignItems: "center", backgroundColor: colors.card },
  oxText: { color: colors.text, fontSize: 26, fontWeight: "800" },
  opt: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: space.sm, backgroundColor: colors.card },
  optText: { color: colors.text, fontSize: 14 },
  optRight: { borderColor: colors.success, backgroundColor: "#12301F" },
  optWrong: { borderColor: colors.danger, backgroundColor: "#3A1414" },
  quizRes: { fontSize: 13, lineHeight: 19 },
});
