import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * 게임 효과음·진동 (설정에서 끌 수 있음, 기억함).
 * tap = 가볍게 톡, coin = 자원 받기, build = 짓기·옮기기, done = 공사 끝·보상.
 */
export type Fx = "tap" | "coin" | "build" | "done";

const KEY = "game_fx";
const SRC: Record<Fx, number> = {
  tap: require("../../assets/sfx/tap.wav"),
  coin: require("../../assets/sfx/coin.wav"),
  build: require("../../assets/sfx/build.wav"),
  done: require("../../assets/sfx/done.wav"),
};
const players: Partial<Record<Fx, AudioPlayer>> = {};
let on: boolean | null = null;

export async function fxOn() {
  if (on === null) on = (await AsyncStorage.getItem(KEY)) !== "off";
  return on;
}

export async function setFxOn(v: boolean) {
  on = v;
  await AsyncStorage.setItem(KEY, v ? "on" : "off");
}

export function fx(kind: Fx) {
  if (on === false) return;
  void (async () => {
    if (!(await fxOn())) return;
    try {
      if (Platform.OS !== "web") {
        const style = kind === "tap" ? Haptics.ImpactFeedbackStyle.Light : kind === "build" ? Haptics.ImpactFeedbackStyle.Medium : null;
        if (style) void Haptics.impactAsync(style);
        else void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      let p = players[kind];
      if (!p) {
        p = createAudioPlayer(SRC[kind]);
        p.volume = 0.5;
        players[kind] = p;
      }
      void p.seekTo(0);
      p.play();
    } catch {
      // 소리가 안 나도 게임은 그대로
    }
  })();
}
