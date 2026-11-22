import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, Label, Screen } from "@/components/ui";
import { EMOJIS, EMOJI_CHAR, getGallery, listCourses, type Course, type GalleryItem } from "@/lib/api";
import { POSITIONS, PROCESSES } from "@/lib/weld";
import { useSession } from "@/state/session";
import { colors, radius, space } from "@/theme";

/** 갤러리: 분석에 성공한 사진이 자동으로 올라온다. 기본은 우리 반, 전체·다른 반으로 바꿀 수 있다.
 * 누르면 그 분석 결과(측정 결과·AI 리포트·반응·댓글) */
export function GalleryScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const mine = user?.courses?.map((c) => c.id) ?? [];
  const [courses, setCourses] = useState<Course[]>([]);
  const [course, setCourse] = useState<string>(mine[0] ?? "all");
  const [proc, setProc] = useState("");
  const [pos, setPos] = useState("");
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const req = useRef(0);

  useEffect(() => {
    listCourses()
      .then(setCourses)
      .catch(() => null);
  }, []);

  const load = useCallback(() => {
    const n = ++req.current; // 필터를 빨리 바꿔도 마지막 것만 보이게
    setFailed(false);
    getGallery({ course, process: proc, position: pos })
      .then((r) => {
        if (n !== req.current) return;
        setItems(r.items);
        setMore(r.more);
      })
      .catch(() => n === req.current && setFailed(true));
  }, [course, proc, pos]);
  useFocusEffect(load);

  const loadMore = () => {
    if (!items?.length) return;
    setLoadingMore(true);
    getGallery({ course, process: proc, position: pos, before: items[items.length - 1].created_at })
      .then((r) => {
        setItems([...items, ...r.items]);
        setMore(r.more);
      })
      .catch(() => null)
      .finally(() => setLoadingMore(false));
  };

  // 우리 반을 맨 앞에, 그다음 전체, 다른 반
  const courseOptions = [
    ...courses.filter((c) => mine.includes(c.id)).map((c) => ({ value: c.id, label: t("gallery_myCourse", { name: c.name }) })),
    { value: "all", label: t("gallery_allCourses") },
    ...courses.filter((c) => !mine.includes(c.id)).map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <Screen>
      <Chips options={courseOptions} value={course} onChange={setCourse} />
      <Label>{t("upload_process")}</Label>
      <Chips
        options={[{ value: "", label: t("common_all") }, ...PROCESSES.map((v) => ({ value: v, label: v }))]}
        value={proc}
        onChange={setProc}
      />
      <Label>{t("upload_position")}</Label>
      <Chips
        options={[{ value: "", label: t("common_all") }, ...POSITIONS.map((v) => ({ value: v, label: v }))]}
        value={pos}
        onChange={setPos}
      />
      <Text style={styles.hint}>{t("gallery_hint")}</Text>
      {failed ? <Text style={styles.error}>{t("error_network")}</Text> : null}
      {!items && !failed ? <ActivityIndicator color={colors.primary} /> : null}
      {items && items.length === 0 ? <Body muted>{t("gallery_empty")}</Body> : null}
      <View style={styles.grid}>
        {(items ?? []).map((g) => (
          <GalleryCard key={g.id} g={g} />
        ))}
      </View>
      {more ? (
        <AppButton label={loadingMore ? t("auth_working") : t("gallery_more")} variant="secondary" onPress={loadMore} disabled={loadingMore} />
      ) : null}
    </Screen>
  );
}

function GalleryCard({ g }: { g: GalleryItem }) {
  const { t, i18n } = useTranslation();
  const date = new Date(g.created_at).toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" });
  const tops = EMOJIS.filter((e) => (g.reactions[e] ?? 0) > 0);
  const scoreColor = g.score == null ? colors.muted : g.score >= 85 ? colors.success : g.score >= 70 ? colors.warning : colors.danger;
  return (
    <Card style={styles.item} onPress={() => router.push(`/result/${g.id}`)}>
      {g.photo_url ? (
        <Image source={{ uri: g.photo_url }} style={styles.photo} contentFit="cover" transition={150} />
      ) : (
        <View style={[styles.photo, { backgroundColor: colors.cardAlt }]} />
      )}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {g.name}
          </Text>
          {g.score != null ? <Text style={[styles.score, { color: scoreColor }]}>{t("common_points", { score: g.score })}</Text> : null}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {g.role && g.role !== "student" ? `${t(`role_${g.role}`)} · ` : ""}
          {g.courses.join(", ")}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[g.process, g.position].filter(Boolean).join(" · ")} · {date}
        </Text>
        <View style={styles.social}>
          <Text style={styles.socialText} numberOfLines={1}>
            {tops.length ? tops.map((e) => `${EMOJI_CHAR[e]}${g.reactions[e]}`).join(" ") : ""}
          </Text>
          <Text style={styles.socialText}>💬 {g.comment_count}</Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.faint, fontSize: 12 },
  error: { color: colors.danger },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
  item: { width: "47%", padding: 0, overflow: "hidden", gap: 0 },
  photo: { width: "100%", aspectRatio: 4 / 3, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md },
  info: { padding: space.sm, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  name: { color: colors.text, fontWeight: "700", fontSize: 14, flex: 1 },
  score: { fontWeight: "800", fontSize: 13 },
  meta: { color: colors.muted, fontSize: 11 },
  social: { flexDirection: "row", justifyContent: "space-between", gap: 4, marginTop: 2 },
  socialText: { color: colors.muted, fontSize: 11, flexShrink: 1 },
});
