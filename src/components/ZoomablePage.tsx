import { Image } from "expo-image";
import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  GestureDetector,
  usePanGesture,
  usePinchGesture,
  useExclusiveGestures,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/**
 * 교재 한 쪽: 두 손가락으로 벌려 확대, 확대 중엔 한 손가락으로 쪽 안을 움직이고, 두 번 톡 치면 원래 크기.
 * fitWidth(가로 화면)면 쪽을 화면 폭에 맞추고 위아래로 밀어 읽는다.
 * onZoom(true) 동안 바깥 목록은 옆으로 넘어가지 않게 막는다.
 * 한 번 톡 치면 onTap (두 번 톡이 아닐 때만) → 보기 화면이 위아래 바를 숨기거나 보인다.
 */
export function ZoomablePage({
  uri,
  cacheKey,
  width,
  height,
  ratio,
  fitWidth,
  onZoom,
  onTap,
}: {
  uri: string;
  cacheKey: string;
  width: number;
  height: number;
  /** 세로 / 가로 */
  ratio: number;
  fitWidth: boolean;
  onZoom: (zoomed: boolean) => void;
  onTap?: () => void;
}) {
  const [zoomed, setZoomed] = useState(false);
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);

  const report = (z: boolean) => {
    setZoomed(z);
    onZoom(z);
  };

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      "worklet";
      scale.value = Math.min(6, Math.max(1, saved.value * e.scale));
    },
    onDeactivate: () => {
      "worklet";
      saved.value = scale.value;
      if (scale.value <= 1.02) {
        scale.value = withTiming(1);
        saved.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        sx.value = 0;
        sy.value = 0;
        runOnJS(report)(false);
      } else {
        runOnJS(report)(true);
      }
    },
  });
  const pan = usePanGesture({
    enabled: zoomed,
    onUpdate: (e) => {
      "worklet";
      // 확대한 만큼만 움직일 수 있게 (그림이 화면 밖으로 다 나가지 않게)
      const mx = ((scale.value - 1) * width) / 2;
      const my = ((scale.value - 1) * height) / 2;
      tx.value = Math.max(-mx, Math.min(mx, sx.value + e.translationX));
      ty.value = Math.max(-my, Math.min(my, sy.value + e.translationY));
    },
    onDeactivate: () => {
      "worklet";
      sx.value = tx.value;
      sy.value = ty.value;
    },
  });
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      "worklet";
      if (scale.value > 1) {
        scale.value = withTiming(1);
        saved.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        sx.value = 0;
        sy.value = 0;
        runOnJS(report)(false);
      } else {
        scale.value = withTiming(2.5);
        saved.value = 2.5;
        runOnJS(report)(true);
      }
    },
  });
  const tap = () => onTap?.();
  const singleTap = useTapGesture({
    numberOfTaps: 1,
    onActivate: () => {
      "worklet";
      runOnJS(tap)();
    },
  });
  // 두 번 톡이 먼저: 두 번 톡이 아니라고 확인된 뒤에만 한 번 톡
  const taps = useExclusiveGestures(doubleTap, singleTap);
  const gesture = useSimultaneousGestures(pinch, pan, taps);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const imgH = fitWidth ? Math.max(height, width * ratio) : height;
  const body = (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[{ width, height: imgH }, style]}>
        <Image source={{ uri, cacheKey }} style={StyleSheet.absoluteFill} contentFit="contain" cachePolicy="memory-disk" transition={100} />
      </Animated.View>
    </GestureDetector>
  );

  return (
    <View style={{ width, height, overflow: "hidden" }}>
      {fitWidth ? (
        <ScrollView scrollEnabled={!zoomed} showsVerticalScrollIndicator nestedScrollEnabled>
          {body}
        </ScrollView>
      ) : (
        body
      )}
    </View>
  );
}
