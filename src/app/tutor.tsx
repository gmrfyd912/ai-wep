import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as IntentLauncher from "expo-intent-launcher";
import * as Speech from "expo-speech";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
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

import { StudyBuddy, VOICE } from "@/components/StudyBuddy";
import {
  answerTutorQuiz,
  askTutorStream,
  reportQuestion,
  reportTutor,
  type DailyItem,
  type TutorReply,
  type TutorTurn,
} from "@/lib/api";
import { textbookError } from "@/screens/TextbookParts";
import { useSession } from "@/state/session";
import { colors, radius, space } from "@/theme";

const AUTO_KEY = "tutor_auto"; // 말이 멈추면 자동으로 보내기
const FOLLOW_KEY = "tutor_follow"; // 대답 뒤 이어 듣기
const QUIET_MS = 1500; // 받아쓴 글자가 이만큼 안 바뀌면 말이 끝난 것으로 본다
const FOLLOW_S = 8; // 대답 뒤 이어 말하기를 기다리는 시간
const MARK = ["①", "②", "③", "④"];
/** 안드로이드는 앱 안 🎤 버튼으로 구글 음성 입력 창을 연다 (Expo Go 에서도 됨). 아이폰은 자판 받아쓰기 */
const ANDROID = Platform.OS === "android";
const OX = ["O", "X"];
/** 말 끝에 붙이면 바로 보내는 말 */
const END_RE = /\s*(끝|다\s*했어요?|다했어요?|이상입니다|over|done|that'?s all|selesai|xong|tamom|listo|tapos na|เสร็จแล้ว)[.!?。\s]*$/i;
/** 이 말만 하면 대화를 끝낸다 */
/** 문장 끝 (여기까지 오면 웰디가 먼저 말한다) */
const SENT_RE = /^[\s\S]*?(?:[.!?。！？…]+(?=\s)|\n)/;
const CLOSE_RE =
  /^\s*(고마워요?|고맙습니다|감사합니다|감사해요|그만(해|할게|하자)?|됐어요?|thanks?( you)?|thank you|bye|stop|cảm ơn|terima kasih|rahmat|gracias|salamat|ขอบคุณ(ครับ|ค่ะ)?)[.!?\s]*$/i;

type Msg = {
  n: number;
  who: "me" | "buddy";
  text: string;
  res?: TutorReply;
  quiz?: DailyItem;
  reported?: boolean;
  quizReported?: boolean;
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
  const [noVoice, setNoVoice] = useState(false); // 안드로이드인데 음성 입력 창을 못 여는 휴대폰
  const [making, setMaking] = useState(false); // 새 문제를 만드는 중

  const input = useRef<TextInputInstance | null>(null);
  const list = useRef<ScrollViewInstance | null>(null);
  const quiet = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const dictating = useRef(false); // 받아쓰기처럼 글자가 한꺼번에 들어오면 true (손으로 칠 때는 자동으로 안 보냄)
  const counter = useRef(0);
  // 처음 인사가 끝나면: 안드로이드는 바로 듣기, 아이폰은 자판 받아쓰기를 기다림 (8초 기다리기 없음)
  const afterSpeak = useRef<null | (() => void)>(() => (ANDROID ? voice() : setPhase("ready")));
  const textRef = useRef("");
  const focused = useRef(true);
  const voiceOpen = useRef(false);
  // 대답을 쓰는 대로 받아 문장마다 바로 말한다
  const queue = useRef<string[]>([]); // 아직 안 한 문장
  const pending = useRef(""); // 아직 문장이 안 끝난 글자
  const ended = useRef(true); // 대답을 다 받았나
  const waiting = useRef(false); // 말을 다 하고 다음 문장을 기다리는 중
  const silent = useRef(false); // 웰디를 눌러 멈췄으면 남은 대답은 말하지 않고 글자로만
  const finalThen = useRef<null | (() => void)>(null); // 마지막 문장까지 말한 뒤 할 일
  const speaking = useRef(false); // 웰디가 지금 말하는 중
  const seen = useRef<number | null>(null); // 대화에서 열어 본 교재 쪽 ("이 페이지에는 없잖아" 할 때 같이 보낸다)

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      return () => {
        focused.current = false;
      };
    }, []),
  );

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
    speaking.current = true;
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

  /** 안드로이드: 구글 음성 입력 창으로 듣고, 받아쓴 말을 바로 보낸다. 말이 없거나 취소하면 대화 끝 */
  const voice = async (followUp = false) => {
    if (!focused.current || voiceOpen.current) return;
    hush();
    stopTimers();
    Keyboard.dismiss();
    setPhase(followUp ? "follow" : "ready");
    voiceOpen.current = true;
    try {
      const r = await IntentLauncher.startActivityAsync("android.speech.action.RECOGNIZE_SPEECH", {
        extra: {
          "android.speech.extra.LANGUAGE_MODEL": "free_form",
          "android.speech.extra.LANGUAGE": VOICE[lang] ?? lang,
          "android.speech.extra.PROMPT": t("tutor_voicePrompt"),
          "android.speech.extra.MAX_RESULTS": 1,
        },
      });
      voiceOpen.current = false;
      const list = (r.extra as Record<string, unknown> | undefined)?.["android.speech.extra.RESULTS"];
      const said = Array.isArray(list) && typeof list[0] === "string" ? list[0] : "";
      if (r.resultCode === IntentLauncher.ResultCode.Success && said.trim()) send(said);
      else setPhase("closed");
    } catch {
      // 구글 음성 입력이 없는 휴대폰: 자판으로
      voiceOpen.current = false;
      setNoVoice(true);
      setPhase("ready");
      input.current?.focus();
    }
  };

  const listen = () => {
    stopTimers();
    if (ANDROID && !noVoice) return voice();
    setPhase("ready");
    input.current?.focus();
  };

  /** 말 하나가 끝났을 때 */
  const onSpoken = () => {
    speaking.current = false;
    const then = afterSpeak.current;
    afterSpeak.current = null;
    if (then) return then();
    afterAnswer();
  };

  /** 다음 문장을 말한다. 다 말했으면 마지막 할 일 (대답을 아직 받는 중이면 기다린다) */
  const pump = () => {
    if (silent.current) return;
    const next = queue.current.shift();
    if (next) {
      waiting.current = false;
      say(next, pump);
      return;
    }
    if (!ended.current) {
      waiting.current = true;
      return;
    }
    waiting.current = false;
    const fin = finalThen.current;
    finalThen.current = null;
    if (fin) fin();
    else afterAnswer();
  };

  /** 받은 글자에서 끝난 문장을 꺼내 말할 차례에 넣는다 */
  const takeSentences = (flush: boolean) => {
    let m: RegExpExecArray | null;
    while ((m = SENT_RE.exec(pending.current))) {
      const one = m[0].trim();
      pending.current = pending.current.slice(m[0].length);
      if (one) queue.current.push(one);
    }
    if (flush && pending.current.trim()) {
      queue.current.push(pending.current.trim());
      pending.current = "";
    }
    if (waiting.current && queue.current.length) pump();
  };

  /** 지금 하는 말과 남은 문장을 멈춘다 (대답 글자는 계속 받는다) */
  const hush = () => {
    Speech.stop();
    afterSpeak.current = null;
    silent.current = true;
    speaking.current = false;
    queue.current = [];
    waiting.current = false;
    finalThen.current = null;
  };

  /** 대답을 다 말한 뒤: 이어 듣기가 켜져 있으면 8초 동안 기다린다 */
  const afterAnswer = () => {
    if (!follow) {
      setPhase("closed");
      Keyboard.dismiss();
      return;
    }
    if (ANDROID && !noVoice) return voice(true); // 음성 입력 창을 다시 연다 (말이 없으면 창이 알아서 닫힘)
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
    return out.slice(-5);
  };

  /** 바로 전 웰디 대답의 확인된 교재 쪽 ("그 페이지 펼쳐줘"). 더 앞 대화로 거슬러 가지 않는다.
   *  이 화면에서 아직 대답이 없으면 null (서버가 30분 안의 마지막 대화를 본다) */
  const lastPages = (): number[] | null => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const r = msgs[i].res;
      if (msgs[i].who !== "buddy" || !r) continue;
      const out = [...(r.open ? [r.open.page] : []), ...r.pages.map((p) => p.page), ...(r.quiz?.page ? [r.quiz.page] : [])];
      return [...new Set(out)];
    }
    return null;
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
    speaking.current = false;
    afterSpeak.current = null;
    Keyboard.dismiss();
    setPhase("thinking");
    silent.current = false;
    queue.current = [];
    pending.current = "";
    ended.current = false;
    waiting.current = false;
    finalThen.current = null;
    let live: number | null = null; // 흘려 받는 중인 웰디 말풍선
    let streamed = "";
    try {
      const r = await askTutorStream(q, lang, history(), ctxPage, lastPages(), (ev) => {
        if (ev.t === "status") {
          setMaking(ev.key === "tutor_making");
          return;
        }
        streamed += ev.text;
        if (live === null) live = push({ who: "buddy", text: streamed });
        else {
          const n = live;
          const now = streamed;
          setMsgs((cur) => cur.map((x) => (x.n === n ? { ...x, text: now } : x)));
          setTimeout(() => list.current?.scrollToEnd({ animated: true }), 30);
        }
        if (silent.current) return;
        pending.current += ev.text;
        takeSentences(false);
        if (!speaking.current && queue.current.length) pump(); // 첫 문장이 오면 바로 말하기 시작
      }, seen.current);
      setMaking(false);
      if (r.left !== null) setLeft(r.left);
      const s = replyText(r);
      if (live !== null) {
        // 흘려 받은 대답: 남은 글자를 말하고, 문제가 있으면 문제도 읽는다
        const n = live;
        setMsgs((cur) => cur.map((x) => (x.n === n ? { ...x, text: s, res: r, quiz: r.quiz ?? undefined } : x)));
        ended.current = true;
        if (silent.current) return;
        takeSentences(true);
        if (r.open && r.book_id) {
          // "그 페이지 보여줘" 를 AI 가 알아들었으면: 다 말한 뒤 이어 듣기 대신 교재를 연다
          const bookId = r.book_id;
          const page = r.open.page;
          finalThen.current = () => openBook(bookId, page);
        } else if (r.quiz) {
          queue.current.push(quizText(r.quiz, lang));
          finalThen.current = () => setPhase("closed"); // 문제는 보기를 누르는 동안 기다린다
        }
        if (waiting.current || !speaking.current) pump();
        return;
      }
      ended.current = true;
      push({ who: "buddy", text: s, res: r, quiz: r.quiz ?? undefined });
      const spoken = r.quiz ? `${s} ${quizText(r.quiz, lang)}` : s;
      if (r.open && r.book_id) {
        // "3장 보여줘", "그 페이지 펼쳐줘" → 말하고 바로 교재를 연다 (이어 듣기 안 함)
        const bookId = r.book_id;
        const page = r.open.page;
        say(s, () => openBook(bookId, page));
      } else if (r.quiz) {
        say(spoken, () => setPhase("closed")); // 문제는 보기를 누르는 동안 기다린다
      } else {
        say(spoken);
      }
    } catch (e) {
      setMaking(false);
      ended.current = true;
      const s = textbookError(t, e);
      if (live !== null && streamed.trim()) {
        if (!silent.current) {
          takeSentences(true);
          if (waiting.current || !speaking.current) pump();
        }
        return; // 받은 데까지 보여 준다
      }
      push({ who: "buddy", text: s });
      say(s);
    }
  };

  const onChange = (v: string) => {
    if (phase === "speaking") {
      // 웰디가 말하는 중에 말하기 시작하면 웰디 목소리를 멈춘다 (받아쓰기에 섞이지 않게)
      hush();
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
      hush();
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

  const pick = async (m: Msg, choice: number | string) => {
    if (!m.quiz || m.quiz.result) return;
    hush();
    try {
      const r = await answerTutorQuiz(m.quiz.id, choice, lang);
      setMsgs((cur) => cur.map((x) => (x.n === m.n ? { ...x, quiz: r } : x)));
      const res = r.result!;
      const mine = lang !== "ko" && res.tr ? res.tr.explanation : res.explanation;
      const right = res.correct_choice ?? 0;
      const model = lang !== "ko" && res.tr?.model_answer ? res.tr.model_answer : res.model_answer;
      const head =
        r.kind === "word"
          ? res.correct === null
            ? t("dq_pending")
            : res.correct
              ? t("dq_right")
              : t("tutor_wordWrong", { answer: model })
          : res.correct
            ? t("dq_right")
            : t("dq_wrong", { answer: r.kind === "ox" ? OX[right] : `${MARK[right]} ${choicesOf(r, lang)[right] ?? ""}` });
      silent.current = false;
      say(`${head} ${res.feedback || mine}`.trim());
    } catch (e) {
      say(textbookError(t, e));
    }
  };

  /** 웰디가 만든 문제·은행 문제가 이상하면 신고 (웰디가 만든 문제는 바로 숨김) */
  const reportQuiz = async (m: Msg) => {
    if (!m.quiz || m.quizReported) return;
    try {
      await reportQuestion(m.quiz.id, "");
      setMsgs((cur) => cur.map((x) => (x.n === m.n ? { ...x, quizReported: true } : x)));
    } catch {
      // 신고가 안 되면 그대로 둔다
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

  /** 말을 마친 뒤 교재 쪽 열기 (대화는 끝, 돌아오면 웰디를 눌러 다시 이야기) */
  const openBook = (bookId: string, page: number) => {
    stopTimers();
    setPhase("closed");
    seen.current = page;
    if (focused.current) router.push(`/book?id=${bookId}&page=${page}`);
  };

  const openPage = (bookId: string | null, page: number) => {
    if (!bookId) return;
    hush();
    seen.current = page;
    stopTimers();
    router.push(`/book?id=${bookId}&page=${page}`);
  };

  const status =
    phase === "thinking"
      ? t(making ? "tutor_making" : "tutor_thinking")
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
              {m.res?.cached ? <Text style={styles.tag}>{t("tutor_cachedTag")}</Text> : null}
              {m.quiz ? (
                <QuizCard
                  item={m.quiz}
                  lang={lang}
                  made={!!m.res?.made}
                  reported={!!m.quizReported}
                  onPick={(c) => pick(m, c)}
                  onReport={() => reportQuiz(m)}
                />
              ) : null}
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
            autoFocus={!ANDROID || noVoice}
            editable={phase !== "thinking"}
            onFocus={() => {
              if (phase === "closed") setPhase("ready");
            }}
          />
          {ANDROID && !noVoice && !text.trim() ? (
            <Pressable
              onPress={() => {
                hush();
                voice();
              }}
              disabled={phase === "thinking"}
              style={({ pressed }) => [styles.micBtn, (pressed || phase === "thinking") && { opacity: 0.6 }]}
              accessibilityLabel={t("tutor_mic")}
            >
              <Ionicons name="mic" size={24} color={colors.text} />
            </Pressable>
          ) : null}
          {ANDROID && !noVoice && !text.trim() ? null : (
            <Pressable
              onPress={() => send(text)}
              disabled={!text.trim() || phase === "thinking"}
              style={[styles.sendBtn, (!text.trim() || phase === "thinking") && { opacity: 0.4 }]}
              accessibilityLabel={t("tutor_send")}
            >
              <Ionicons name="arrow-up" size={20} color={colors.text} />
            </Pressable>
          )}
        </View>
        <Text style={styles.micHint}>{ANDROID && !noVoice ? t("tutor_micHintAndroid") : t(noVoice ? "tutor_noVoice" : "tutor_micHint")}</Text>
        <View style={styles.toggles}>
          {ANDROID && !noVoice ? null : (
            <Toggle label={t("tutor_autoSend")} on={auto} onPress={() => toggle(AUTO_KEY, !auto, setAuto)} />
          )}
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

function QuizCard({
  item,
  lang,
  made,
  reported,
  onPick,
  onReport,
}: {
  item: DailyItem;
  lang: string;
  made: boolean;
  reported: boolean;
  onPick: (c: number | string) => void;
  onReport: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [word, setWord] = useState("");
  const res = item.result;
  const choose = (c: number | string) => {
    if (busy || res) return;
    setBusy(true);
    onPick(c);
  };
  useEffect(() => {
    if (res) setBusy(false);
  }, [res]);
  const tone = (i: number) => {
    if (!res) return null;
    if (i === res.correct_choice) return styles.optRight;
    if (String(i) === res.answer) return styles.optWrong;
    return null;
  };
  const explanation = res ? (lang !== "ko" && res.tr ? res.tr.explanation : res.explanation) : "";
  const model = res ? (lang !== "ko" && res.tr?.model_answer ? res.tr.model_answer : res.model_answer) : "";
  const kindLabel = item.kind === "ox" ? t("dq_ox") : item.kind === "word" ? t("dq_word") : t("dq_mc");
  return (
    <View style={styles.quiz}>
      <Text style={styles.quizKind}>
        {kindLabel} · {t("tutor_practice")}
        {item.printed_page ? ` · ${t("dq_pageShort", { page: item.printed_page })}` : ""}
      </Text>
      {made ? <Text style={styles.tag}>{t("tutor_madeTag")}</Text> : null}
      <Text style={styles.quizQ}>{questionOf(item, lang)}</Text>
      {item.kind === "ox" ? (
        <View style={styles.oxRow}>
          {OX.map((o, i) => (
            <Pressable key={o} style={[styles.oxBtn, tone(i)]} onPress={() => choose(i)} disabled={!!res}>
              <Text style={styles.oxText}>{o}</Text>
            </Pressable>
          ))}
        </View>
      ) : item.kind === "word" ? (
        res ? (
          <Text style={styles.optText}>
            {t("dq_myAnswer")}: {res.answer}
          </Text>
        ) : (
          <View style={styles.wordRow}>
            <TextInput
              value={word}
              onChangeText={setWord}
              placeholder={t("dq_wordPh")}
              placeholderTextColor={colors.faint}
              style={styles.wordInput}
              onSubmitEditing={() => word.trim() && choose(word.trim())}
              returnKeyType="send"
            />
            <Pressable
              style={[styles.sendBtn, (!word.trim() || busy) && { opacity: 0.4 }]}
              onPress={() => word.trim() && choose(word.trim())}
              disabled={!word.trim() || busy}
              accessibilityLabel={t("dq_submit")}
            >
              <Ionicons name="arrow-up" size={20} color={colors.text} />
            </Pressable>
          </View>
        )
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
        <Text
          style={[
            styles.quizRes,
            { color: res.correct === null ? colors.warning : res.correct ? colors.success : colors.danger },
          ]}
        >
          {res.correct === null ? t("dq_legendPending") : res.correct ? t("dq_right") : t("dq_legendWrong")}
          {item.kind === "word" && model ? ` · ${t("dq_modelAnswer")}: ${model}` : ""}
          {res.feedback ? ` · ${res.feedback}` : explanation ? ` · ${explanation}` : ""}
        </Text>
      ) : busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : null}
      <Pressable style={styles.flag} onPress={onReport} hitSlop={8} disabled={reported}>
        <Ionicons name={reported ? "flag" : "flag-outline"} size={13} color={reported ? colors.warning : colors.faint} />
        <Text style={[styles.flagText, reported && { color: colors.warning }]}>
          {reported ? t("dq_reported") : t("dq_report")}
        </Text>
      </Pressable>
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
  micBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
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
  tag: { color: colors.primary, fontSize: 12 },
  wordRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  wordInput: { flex: 1, color: colors.text, backgroundColor: colors.card, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: space.md, paddingVertical: 8, fontSize: 15 },
});
