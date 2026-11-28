import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

/**
 * 지도 움직이기·확대: 한 손가락으로 끌어 옮기고, 두 손가락으로 벌리거나 오므려 확대·축소.
 * - 끄는 동안·벌리는 동안은 화면 변환(transform)으로 부드럽게 움직이고,
 *   손을 떼면 onZoom 으로 새 배율을 알려 지도를 그 크기로 다시 그린다 (확대해도 흐려지지 않게).
 * - 칸을 톡 누르는 건 그대로 됨 (10px 넘게 움직여야 끌기로 봄).
 * - 지도가 화면 밖으로 다 나가 버리지 않게 움직일 수 있는 범위를 막는다.
 */
export function PanZoom({
  width,
  height,
  contentW,
  contentH,
  zoom,
  minZoom,
  maxZoom,
  onZoom,
  onMove,
  onTapEmpty,
  zoomNonce = 0,
  grab = null,
  onGrab,
  focus = null,
  edge = 0.35,
  children,
}: {
  width: number;
  height: number;
  /** 지금 배율로 그린 지도 크기 */
  contentW: number;
  contentH: number;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onZoom: (z: number) => void;
  /** 끌기·확대를 시작/끝낼 때 (끝나고 바로 오는 '톡'을 누르기로 보지 않게) */
  onMove?: (moving: boolean) => void;
  /** 지도 그림 바깥(빈 바다)을 눌렀을 때. 끌기와 구분은 부르는 쪽에서 onMove로 함 */
  onTapEmpty?: () => void;
  /** 확대 단추로 zoom 을 바꿀 때 함께 1 올림 → 그 변화는 되돌리지 않고 바로 보이게 */
  zoomNonce?: number;
  /** 끌어서 옮길 수 있는 것(놓을 건물 미리보기)이 지도 그림에서 차지하는 네모. 여기서 끌기 시작하면 지도 대신 그것을 옮김 */
  grab?: { x1: number; y1: number; x2: number; y2: number } | null;
  /** grab 을 끄는 중: 지도 그림 안의 손가락 위치 (시작 start → 움직임 move → 끝 end) */
  onGrab?: (phase: "start" | "move" | "end", x: number, y: number) => void;
  /** 지도 그림 안의 이 점(x, y)이 화면 가운데에 오게 부드럽게 옮김 (n 이 바뀔 때마다) */
  focus?: { x: number; y: number; n: number } | null;
  /** 지도 그림 끝을 넘어 더 끌 수 있는 여유 (화면 크기 비율). 0 = 그림 끝이 화면 끝에 닿으면 멈춤 */
  edge?: number;
  children: ReactNode;
}) {
  const s = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const s0 = useSharedValue(1);
  const tx0 = useSharedValue(0);
  const ty0 = useSharedValue(0);
  const fx = useSharedValue(0);
  const fy = useSharedValue(0);
  const z = useSharedValue(zoom);
  const dim = useSharedValue({ w: width, h: height, cw: contentW, ch: contentH, min: minZoom, max: maxZoom, e: edge });
  const box = useSharedValue<{ x1: number; y1: number; x2: number; y2: number } | null>(grab);
  const dragging = useSharedValue(false);
  useEffect(() => {
    box.value = grab;
  }, [grab, box]);
  // 제스처 설정은 처음 것을 계속 쓸 수 있어서, 최신 onGrab 은 ref 로 부름
  const grabRef = useRef(onGrab);
  grabRef.current = onGrab;
  const grabJS = (phase: "start" | "move" | "end", x: number, y: number) => grabRef.current?.(phase, x, y);

  useEffect(() => {
    dim.value = { w: width, h: height, cw: contentW, ch: contentH, min: minZoom, max: maxZoom, e: edge };
    // 크기가 바뀌면(확대·화면 돌림) 지금 위치도 다시 범위 안으로
    tx.value = clampX(tx.value, s.value);
    ty.value = clampY(ty.value, s.value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, contentW, contentH, minZoom, maxZoom, edge, dim]);

  // 손을 떼서 지도를 새 크기로 다시 그리면, 그만큼 화면 변환 배율을 되돌려 크기가 튀지 않게
  const prev = useRef(zoom);
  const prevNonce = useRef(zoomNonce);
  useLayoutEffect(() => {
    if (prev.current !== zoom) {
      // 단추로 바꾼 확대: 되돌리지 않고 새 크기를 그대로 보여 줌 (끌어 옮긴 거리도 같은 비율로 늘려 보던 곳이 가운데에 남게)
      const r = zoom / prev.current;
      if (prevNonce.current !== zoomNonce) {
        tx.value = tx.value * r;
        ty.value = ty.value * r;
        prevNonce.current = zoomNonce;
        prev.current = zoom;
        z.value = zoom;
        return;
      }
      s.value = (s.value * prev.current) / zoom;
      prev.current = zoom;
    }
    z.value = zoom;
  }, [zoom, zoomNonce, s, z, tx, ty]);

  const clampX = (v: number, sc: number) => {
    "worklet";
    const d = dim.value;
    const lim = Math.max(0, (d.cw * sc - d.w) / 2) + d.w * d.e;
    return Math.min(lim, Math.max(-lim, v));
  };
  const clampY = (v: number, sc: number) => {
    "worklet";
    const d = dim.value;
    const lim = Math.max(0, (d.ch * sc - d.h) / 2) + d.h * d.e;
    return Math.min(lim, Math.max(-lim, v));
  };

  // 짓기 목록에서 건물을 고르면 그 건물로 화면을 옮김
  useEffect(() => {
    if (!focus) return;
    const sc = s.value;
    tx.value = withTiming(clampX(-(focus.x - contentW / 2) * sc, sc), { duration: 350 });
    ty.value = withTiming(clampY(-(focus.y - contentH / 2) * sc, sc), { duration: 350 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  const moved = (v: boolean) => onMove?.(v);
  const pinch = usePinchGesture({
    onActivate: (e) => {
      "worklet";
      runOnJS(moved)(true);
      s0.value = s.value;
      tx0.value = tx.value;
      ty0.value = ty.value;
      fx.value = e.focalX - dim.value.w / 2;
      fy.value = e.focalY - dim.value.h / 2;
    },
    onUpdate: (e) => {
      "worklet";
      const d = dim.value;
      const ns = Math.min(d.max / z.value, Math.max(d.min / z.value, s0.value * e.scale));
      // 두 손가락 가운데 점이 가리키는 곳이 그 자리에 머물게
      const px = (fx.value - tx0.value) / s0.value;
      const py = (fy.value - ty0.value) / s0.value;
      s.value = ns;
      tx.value = clampX(fx.value - ns * px, ns);
      ty.value = clampY(fy.value - ns * py, ns);
    },
    onDeactivate: () => {
      "worklet";
      if (Math.abs(s.value - 1) > 0.01) runOnJS(onZoom)(z.value * s.value);
      runOnJS(moved)(false);
    },
  });
  // 화면 위 점 → 지도 그림 안의 점
  const toContent = (sx: number, sy: number) => {
    "worklet";
    const d = dim.value;
    return { x: (sx - d.w / 2 - tx.value) / s.value + d.cw / 2, y: (sy - d.h / 2 - ty.value) / s.value + d.ch / 2 };
  };
  const pan = usePanGesture({
    minDistance: 10,
    maxPointers: 1,
    onActivate: (e) => {
      "worklet";
      runOnJS(moved)(true);
      tx0.value = tx.value;
      ty0.value = ty.value;
      const b = box.value;
      const p0 = toContent(e.x - e.translationX, e.y - e.translationY);
      if (b && p0.x >= b.x1 && p0.x <= b.x2 && p0.y >= b.y1 && p0.y <= b.y2) {
        dragging.value = true;
        runOnJS(grabJS)("start", p0.x, p0.y);
        const p = toContent(e.x, e.y);
        runOnJS(grabJS)("move", p.x, p.y);
      }
    },
    onUpdate: (e) => {
      "worklet";
      if (dragging.value) {
        const p = toContent(e.x, e.y);
        runOnJS(grabJS)("move", p.x, p.y);
        return;
      }
      tx.value = clampX(tx0.value + e.translationX, s.value);
      ty.value = clampY(ty0.value + e.translationY, s.value);
    },
    onDeactivate: (e) => {
      "worklet";
      if (dragging.value) {
        dragging.value = false;
        const p = toContent(e.x, e.y);
        runOnJS(grabJS)("end", p.x, p.y);
      }
      runOnJS(moved)(false);
    },
  });
  const gesture = useSimultaneousGestures(pinch, pan);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: s.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} collapsable={false}>
        {onTapEmpty ? <Pressable style={StyleSheet.absoluteFill} onPress={onTapEmpty} accessible={false} /> : null}
        <Animated.View
          style={[{ position: "absolute", left: (width - contentW) / 2, top: (height - contentH) / 2, width: contentW, height: contentH }, style]}
        >
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}
