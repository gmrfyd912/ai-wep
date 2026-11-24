import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Speech from "expo-speech";
import { useFocusEffect } from "expo-router";
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
const VOICE: Record<string, string> = {
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
const H = Math.round((W * 364) / 240);

/**
 * AI 학습 보조 캐릭터: 말할 때 입이 움직이고(그림 4장), 자막은 항상 글자로 보여 준다.
 * 목소리는 휴대폰 기본 음성 (소리 끄기 가능, 설정 기억). 캐릭터를 누르면 다시 말한다.
 */
export function StudyBuddy({ text }: { text: string }) {
  const { t, i18n } = useTranslation();
  const [frame, setFrame] = useState(0);
  const [shown, setShown] = useState(""); // 자막 (한 글자씩)
  const [sound, setSound] = useState<boolean | null>(null);
  const talking = useRef(false);
  const mouth = useRef<ReturnType<typeof setInterval> | null>(null);
  const typing = useRef<ReturnType<typeof setInterval> | null>(null);

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
        return;
      }
      startMouth(null);
      Speech.speak(text, {
        language: VOICE[i18n.language] ?? i18n.language,
        rate: 1.0,
        pitch: 1.15,
        onDone: stopMouth,
        onStopped: stopMouth,
        onError: stopMouth,
      });
    },
    [text, i18n.language, startMouth, stopMouth],
  );

  // 화면에 들어오면 한 번 인사 (말이 바뀌면 다시)
  useEffect(() => {
    if (sound === null || !text) return;
    say(sound);
  }, [text, sound === null]); // eslint-disable-line react-hooks/exhaustive-deps

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
    useCallback(
      () => () => {
        Speech.stop();
        stopMouth();
      },
      [stopMouth],
    ),
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
      <Pressable onPress={() => say(!!sound)} accessibilityLabel={t("buddy_name")}>
        <View style={{ width: W, height: H }}>
          {FRAMES.map((src, i) => (
            <Image key={i} source={src} style={[styles.img, { opacity: frame === i ? 1 : 0 }]} resizeMode="contain" />
          ))}
        </View>
      </Pressable>
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
        <Text style={styles.hint}>{t("buddy_tapHint")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  img: { position: "absolute", width: W, height: H },
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
