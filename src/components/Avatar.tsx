import { Image } from "expo-image";
import { StyleSheet, Text, View } from "react-native";

import { colors } from "@/theme";

/** 이름 옆 둥근 프로필 사진. 사진이 없으면 이름 첫 글자 */
export function Avatar({
  url,
  cacheKey,
  name,
  size = 32,
}: {
  url?: string | null;
  cacheKey?: string | null;
  name?: string | null;
  size?: number;
}) {
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (url) {
    return (
      <Image
        source={{ uri: url, cacheKey: cacheKey ?? undefined }}
        style={[styles.img, box]}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={120}
      />
    );
  }
  const letter = (name ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <View style={[styles.fallback, box]}>
      <Text style={[styles.letter, { fontSize: Math.round(size * 0.45) }]}>{letter}</Text>
    </View>
  );
}

/** 목록 줄 아래 작은 비드 그림 (결과 화면 확인 그림을 줄인 것) */
export function BeadStrip({ url, cacheKey, ratio }: { url?: string | null; cacheKey?: string | null; ratio?: number | null }) {
  if (!url) return null;
  const r = ratio && ratio > 0 ? Math.min(Math.max(ratio, 2), 12) : 6;
  return (
    <Image
      source={{ uri: url, cacheKey: cacheKey ?? undefined }}
      style={[styles.bead, { aspectRatio: r }]}
      contentFit="contain"
      cachePolicy="memory-disk"
      transition={120}
    />
  );
}

const styles = StyleSheet.create({
  img: { backgroundColor: colors.cardAlt },
  fallback: { backgroundColor: colors.primaryDim, alignItems: "center", justifyContent: "center" },
  letter: { color: colors.primary, fontWeight: "800" },
  bead: { width: "100%", borderRadius: 6 },
});
