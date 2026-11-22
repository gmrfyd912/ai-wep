import { Image } from "expo-image";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { Body, Card, Chips, Label, Screen } from "@/components/ui";
import {
  EMOJIS,
  EMOJI_CHAR,
  authErrorKey,
  getGallery,
  listCourses,
  setReaction,
  type Course,
  type Emoji,
  type GalleryItem,
} from "@/lib/api";
import { POSITIONS, PROCESSES } from "@/lib/weld";
import { CommentSheet } from "@/screens/Comments";
import { useSession } from "@/state/session";
import { colors, radius, space } from "@/theme";

type List = { items: GalleryItem[]; more: boolean };
/** 필터별로 마지막에 받은 목록: 다시 들어오면 바로 보여 주고 뒤에서 새로 받는다 */
const lastLists = new Map<string, List>();
let lastCourses: Course[] = [];

/** 갤러리: 분석에 성공한 사진이 자동으로 올라온다. 기본은 우리 반, 전체·다른 반으로 바꿀 수 있다.
 * 사진을 누르면 분석 결과, 😊 로 바로 반응, 💬 로 바로 댓글 */
export function GalleryScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const mine = user?.courses?.map((c) => c.id) ?? [];
  const [courses, setCourses] = useState<Course[]>(lastCourses);
  const [course, setCourse] = useState<string>(mine[0] ?? "all");
  const [proc, setProc] = useState("");
  const [pos, setPos] = useState("");
  const key = `${course}|${proc}|${pos}`;
  const [list, setList] = useState<List | null>(lastLists.get(key) ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [picker, setPicker] = useState<string | null>(null); // 반응 고르는 중인 사진
  const [sheet, setSheet] = useState<string | null>(null); // 댓글 창을 연 사진
  const [msg, setMsg] = useState("");
  const req = useRef(0);

  useEffect(() => {
    listCourses()
      .then((c) => {
        lastCourses = c;
        setCourses(c);
      })
      .catch(() => null);
  }, []);

  const keep = useCallback(
    (next: List) => {
      lastLists.set(key, next);
      setList(next);
    },
    [key],
  );

  const load = useCallback(() => {
    const n = ++req.current; // 필터를 빨리 바꿔도 마지막 것만 보이게
    setFailed(false);
    setList(lastLists.get(key) ?? null);
    getGallery({ course, process: proc, position: pos })
      .then((r) => n === req.current && keep(r))
      .catch(() => n === req.current && !lastLists.get(key) && setFailed(true));
  }, [course, proc, pos, key, keep]);
  useFocusEffect(load);

  const loadMore = () => {
    if (!list?.more || !list.items.length || loadingMore) return;
    const n = req.current;
    setLoadingMore(true);
    getGallery({ course, process: proc, position: pos, before: list.items[list.items.length - 1].created_at })
      .then((r) => {
        if (n !== req.current) return;
        const seen = new Set(list.items.map((g) => g.id));
        keep({ items: [...list.items, ...r.items.filter((g) => !seen.has(g.id))], more: r.more });
      })
      .catch(() => null)
      .finally(() => setLoadingMore(false));
  };

  const patch = (id: string, fields: Partial<GalleryItem>) => {
    if (!list) return;
    keep({ ...list, items: list.items.map((g) => (g.id === id ? { ...g, ...fields } : g)) });
  };

  const react = async (g: GalleryItem, e: Emoji) => {
    setPicker(null);
    setMsg("");
    const next = g.my_reaction === e ? null : e; // 같은 걸 다시 고르면 취소
    // 먼저 화면에 바로 반영하고, 서버 답으로 맞춘다
    const counts = { ...g.reactions };
    if (g.my_reaction) counts[g.my_reaction] = Math.max(0, (counts[g.my_reaction] ?? 1) - 1);
    if (next) counts[next] = (counts[next] ?? 0) + 1;
    patch(g.id, { reactions: counts, my_reaction: next });
    try {
      const r = await setReaction(g.id, next);
      patch(g.id, { reactions: r.reactions, my_reaction: r.my_reaction });
    } catch (err) {
      patch(g.id, { reactions: g.reactions, my_reaction: g.my_reaction });
      setMsg(t(authErrorKey(err).key as "error_network"));
    }
  };

  // 우리 반을 맨 앞에, 그다음 전체, 다른 반
  const courseOptions = [
    ...courses.filter((c) => mine.includes(c.id)).map((c) => ({ value: c.id, label: t("gallery_myCourse", { name: c.name }) })),
    { value: "all", label: t("gallery_allCourses") },
    ...courses.filter((c) => !mine.includes(c.id)).map((c) => ({ value: c.id, label: c.name })),
  ];
  const items = list?.items;

  return (
    <Screen onEndReached={loadMore}>
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
      {msg ? <Text style={styles.error}>{msg}</Text> : null}
      {!items && !failed ? <ActivityIndicator color={colors.primary} /> : null}
      {items && items.length === 0 ? <Body muted>{t("gallery_empty")}</Body> : null}
      <View style={styles.grid}>
        {(items ?? []).map((g) => (
          <GalleryCard
            key={g.id}
            g={g}
            picking={picker === g.id}
            onPick={() => setPicker(picker === g.id ? null : g.id)}
            onReact={(e) => react(g, e)}
            onComments={() => {
              setPicker(null);
              setSheet(g.id);
            }}
          />
        ))}
      </View>
      {loadingMore ? <ActivityIndicator color={colors.primary} /> : null}
      <CommentSheet
        sid={sheet}
        onClose={(count) => {
          if (sheet && count != null) patch(sheet, { comment_count: count });
          setSheet(null);
        }}
      />
    </Screen>
  );
}

function GalleryCard({
  g,
  picking,
  onPick,
  onReact,
  onComments,
}: {
  g: GalleryItem;
  picking: boolean;
  onPick: () => void;
  onReact: (e: Emoji) => void;
  onComments: () => void;
}) {
  const { t, i18n } = useTranslation();
  const date = new Date(g.created_at).toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" });
  const tops = EMOJIS.filter((e) => (g.reactions[e] ?? 0) > 0);
  const scoreColor = g.score == null ? colors.muted : g.score >= 85 ? colors.success : g.score >= 70 ? colors.warning : colors.danger;
  return (
    <Card style={styles.item}>
      <Pressable onPress={() => router.push(`/result/${g.id}`)} style={({ pressed }) => pressed && { opacity: 0.7 }}>
        <View>
          {g.photo_url ? (
            <Image
              source={{ uri: g.photo_url, cacheKey: g.photo_key ?? undefined }}
              style={styles.photo}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={150}
              recyclingKey={g.id}
            />
          ) : (
            <View style={[styles.photo, { backgroundColor: colors.cardAlt }]} />
          )}
          {picking ? (
            // 사진 아래쪽에 반응 6가지가 떠오른다
            <View style={styles.picker}>
              {EMOJIS.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => onReact(e)}
                  hitSlop={4}
                  style={[styles.pickItem, g.my_reaction === e && styles.pickOn]}
                  accessibilityLabel={t(`emoji_${e}`)}
                >
                  <Text style={styles.pickChar}>{EMOJI_CHAR[e]}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Avatar url={g.avatar_url} cacheKey={g.avatar_key} name={g.name} size={22} />
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
        </View>
      </Pressable>
      <View style={styles.social}>
        <Pressable
          onPress={onPick}
          hitSlop={6}
          style={[styles.socialBtn, (picking || g.my_reaction) && styles.socialBtnOn]}
          accessibilityLabel={t("gallery_react")}
        >
          <Text style={styles.socialChar}>{g.my_reaction ? EMOJI_CHAR[g.my_reaction] : "😊"}</Text>
          {!g.my_reaction ? <Text style={styles.plus}>+</Text> : null}
        </Pressable>
        <Text style={styles.socialText} numberOfLines={1}>
          {tops.map((e) => `${EMOJI_CHAR[e]}${g.reactions[e]}`).join(" ")}
        </Text>
        <Pressable onPress={onComments} hitSlop={6} style={styles.socialBtn} accessibilityLabel={t("gallery_comment")}>
          <Text style={styles.socialChar}>💬</Text>
          <Text style={styles.socialCount}>{g.comment_count}</Text>
        </Pressable>
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
  picker: {
    position: "absolute",
    left: 4,
    right: 4,
    bottom: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "rgba(10,14,26,0.92)",
    borderRadius: 18,
    paddingHorizontal: 4,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pickItem: { paddingHorizontal: 2, paddingVertical: 1, borderRadius: 12 },
  pickOn: { backgroundColor: colors.primaryDim },
  pickChar: { fontSize: 19 },
  info: { padding: space.sm, paddingBottom: 4, gap: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { color: colors.text, fontWeight: "700", fontSize: 14, flex: 1 },
  score: { fontWeight: "800", fontSize: 13 },
  meta: { color: colors.muted, fontSize: 11 },
  social: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space.sm,
    paddingBottom: space.sm,
    paddingTop: 2,
  },
  socialBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  socialBtnOn: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  socialChar: { fontSize: 14 },
  plus: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  socialCount: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  socialText: { color: colors.muted, fontSize: 11, flex: 1 },
});
