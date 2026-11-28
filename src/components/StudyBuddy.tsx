import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import { useFocusEffect, useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { colors, radius, space } from "@/theme";

const FRAMES = [
  require("../../assets/buddy/m0.png"),
  require("../../assets/buddy/m1.png"),
  require("../../assets/buddy/m2.png"),
  require("../../assets/buddy/m3.png"),
];
const SOUND_KEY = "buddy_sound";
/** 앱 언어 → 휴대폰 음성 언어 */
export const VOICE: Record<string, string> = {
  ko: "ko-KR",
  en: "en-US",
  vi: "vi-VN",
  th: "th-TH",
  fil: "fil-PH",
  uz: "uz-UZ",
  id: "id-ID",
  es: "es-ES",
};
const W = 104;
const ratio = 364 / 240;

/**
 * AI 학습 보조 캐릭터 '웰디': 말할 때 입이 움직이고(그림 4장), 자막은 항상 글자로 보여 준다.
 * 목소리는 휴대폰 기본 음성 (소리 끄기 가능, 설정 기억).
 * onPress 가 없으면 캐릭터를 누를 때 다시 말한다. nonce 가 바뀌면 같은 말도 다시 한다.
 * onDone: 말(또는 자막)이 끝났을 때.
 */
export function StudyBuddy({
  text,
  nonce = 0,
  onPress,
  onDone,
  hint,
  size = W,
  compact = false,
  lines,
  boxLines,
}: {
  text: string;
  nonce?: number;
  onPress?: () => void;
  onDone?: () => void;
  hint?: string;
  size?: number;
  /** 게임 화면처럼 작게: 이름·안내 줄 없이 얼굴 + 말풍선 + 소리 버튼만 */
  compact?: boolean;
  /** compact 말풍선 글 줄 수 제한 (넘으면 … ) */
  lines?: number;
  /** compact 말풍선 높이를 이 줄 수로 고정 (글이 짧아도 같은 크기) */
  boxLines?: number;
}) {
  const H = Math.round(size * ratio);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const { t, i18n } = useTranslation();
  const [frame, setFrame] = useState(0);
  const [shown, setShown] = useState(""); // 자막 (한 글자씩)
  const [sound, setSound] = useState<boolean | null>(null);
  const talking = useRef(false);
  const mouth = useRef<ReturnType<typeof setInterval> | null>(null);
  const typing = useRef<ReturnType<typeof setInterval> | null>(null);
  // 다른 화면(오늘의 문제 등)이 위에 떠 있는 동안에는 말하지 않음 (뒤에서 같은 안내가 또 나오지 않게)
  const isFocused = useIsFocused();
  const focused = useRef(isFocused);
  focused.current = isFocused;
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    AsyncStorage.getItem(SOUND_KEY).then((v) => setSound(v !== "off"));
  }, []);

  const stopMouth = useCallback(() => {
    talking.current = false;
    if (mouth.current) clearInterval(mouth.current);
    mouth.current = null;
    setFrame(0);
  }, []);

  const startMouth = useCallback(
    (ms: number | null) => {
      if (mouth.current) clearInterval(mouth.current);
      talking.current = true;
      let k = 0;
      const seq = [1, 2, 3, 2, 1, 0, 2, 3, 1, 0];
      mouth.current = setInterval(() => {
        k += 1;
        setFrame(seq[k % seq.length]);
      }, 110);
      // 소리 없이 자막만 나올 때는 글자 나오는 동안만 입을 움직인다
      if (ms !== null) setTimeout(stopMouth, ms);
    },
    [stopMouth],
  );

  const say = useCallback(
    (withSound: boolean) => {
      Speech.stop();
      if (typing.current) clearInterval(typing.current);
      let n = 0;
      setShown("");
      typing.current = setInterval(() => {
        n += 1;
        setShown(text.slice(0, n));
        if (n >= text.length && typing.current) clearInterval(typing.current);
      }, 45);
      if (!withSound) {
        startMouth(text.length * 45);
        setTimeout(() => doneRef.current?.(), text.length * 45 + 300);
        return;
      }
      startMouth(null);
      const finished = () => {
        stopMouth();
        doneRef.current?.();
      };
      Speech.speak(text, {
        language: VOICE[i18n.language] ?? i18n.language,
        rate: 1.0,
        pitch: 1.15,
        onDone: finished,
        onStopped: stopMouth,
        onError: finished,
      });
    },
    [text, i18n.language, startMouth, stopMouth],
  );

  // 화면에 들어오면 한 번 인사 (말이 바뀌면 다시)
  useEffect(() => {
    if (sound === null || !text) return;
    if (!focused.current) {
      setShown(text);   // 뒤에 있을 때 말이 바뀌면 소리 없이 글만
      return;
    }
    say(sound);
  }, [text, nonce, sound === null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      Speech.stop();
      if (mouth.current) clearInterval(mouth.current);
      if (typing.current) clearInterval(typing.current);
    },
    [],
  );

  // 다른 탭·화면으로 가면 말을 멈춘다
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setShown((cur) => (cur.length < textRef.current.length ? textRef.current : cur));
      return () => {
        focused.current = false;
        Speech.stop();
        stopMouth();
        if (typing.current) clearInterval(typing.current);
      };
    }, [stopMouth]),
  );

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    AsyncStorage.setItem(SOUND_KEY, next ? "on" : "off");
    if (!next) {
      Speech.stop();
      stopMouth();
    }
  };

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={onPress ?? (() => say(!!sound))}
        accessibilityLabel={t("buddy_name")}
        hitSlop={8}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}
      >
        <View style={{ width: size, height: H }}>
          {FRAMES.map((src, i) => (
            <Image key={i} source={src} style={[styles.img, { width: size, height: H, opacity: frame === i ? 1 : 0 }]} resizeMode="contain" />
          ))}
        </View>
      </Pressable>
      {compact ? (
        <View style={[styles.bubble, styles.bubbleSmall]}>
          <Text style={[styles.textSmall, boxLines ? { height: boxLines * 18 + 12 } : null]} numberOfLines={lines}>{shown || " "}</Text>
          <Pressable onPress={toggleSound} hitSlop={10} style={styles.soundSmall} accessibilityLabel={sound ? t("buddy_soundOn") : t("buddy_soundOff")}>
            <Ionicons name={sound ? "volume-high-outline" : "volume-mute-outline"} size={15} color={colors.muted} />
          </Pressable>
        </View>
      ) : (
      <View style={{ flex: 1, gap: space.xs }}>
        <View style={styles.head}>
          <Text style={styles.name}>{t("buddy_name")}</Text>
          <Pressable onPress={toggleSound} hitSlop={10} style={styles.soundBtn}>
            <Ionicons name={sound ? "volume-high-outline" : "volume-mute-outline"} size={18} color={colors.muted} />
            <Text style={styles.soundText}>{sound ? t("buddy_soundOn") : t("buddy_soundOff")}</Text>
          </Pressable>
        </View>
        <View style={styles.bubble}>
          <Text style={styles.text}>{shown || " "}</Text>
        </View>
        <Text style={styles.hint}>{hint ?? t("buddy_tapHint")}</Text>
      </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  img: { position: "absolute" },
  bubbleSmall: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 6, paddingVertical: 6, paddingHorizontal: 10, minHeight: 0 },
  textSmall: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  soundSmall: { paddingTop: 1 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  soundBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  soundText: { color: colors.muted, fontSize: 12 },
  bubble: {
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    borderBottomLeftRadius: 2,
    padding: space.md,
    minHeight: 96,
  },
  text: { color: colors.text, fontSize: 15, lineHeight: 22 },
  hint: { color: colors.faint, fontSize: 11 },
});
