import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import {
  GestureDetector,
  GestureHandlerRootView,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "@/theme";

/** 전체 화면 그림 보기: 두 손가락 확대·축소, 한 손가락 이동, 두 번 톡 치면 원래 크기 */
export function ZoomImage({ uri, visible, onClose }: { uri: string; visible: boolean; onClose: () => void }) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      "worklet";
      scale.value = Math.min(8, Math.max(1, savedScale.value * e.scale));
    },
    onDeactivate: () => {
      "worklet";
      savedScale.value = scale.value;
    },
  });
  const pan = usePanGesture({
    onUpdate: (e) => {
      "worklet";
      tx.value = savedX.value + e.translationX;
      ty.value = savedY.value + e.translationY;
    },
    onDeactivate: () => {
      "worklet";
      savedX.value = tx.value;
      savedY.value = ty.value;
    },
  });
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      "worklet";
      scale.value = withTiming(1);
      savedScale.value = 1;
      tx.value = withTiming(0);
      ty.value = withTiming(0);
      savedX.value = 0;
      savedY.value = 0;
    },
  });
  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  function close() {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedX.value = 0;
    savedY.value = 0;
    onClose();
  }

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={close} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={[styles.fill, style]}>
            <Image source={{ uri }} style={styles.fill} contentFit="contain" />
          </Animated.View>
        </GestureDetector>
        <SafeAreaView style={styles.closeWrap} edges={["top", "right"]} pointerEvents="box-none">
          <Pressable onPress={close} hitSlop={16} style={styles.close}>
            <Ionicons name="close" size={26} color={colors.text} />
          </Pressable>
        </SafeAreaView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  fill: { flex: 1, width: "100%" },
  closeWrap: { position: "absolute", top: 0, right: 0 },
  close: { margin: 12, padding: 8, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.6)" },
});
