import Ionicons from "@expo/vector-icons/Ionicons";
import * as ScreenOrientation from "expo-screen-orientation";
import { StatusBar } from "expo-status-bar";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { ZoomablePage } from "@/components/ZoomablePage";
import { getMyTextbook, getTextbook, getTextbookPages, saveTextbookProgress, type TextbookPage, type TocPart } from "@/lib/api";
import { textbookError } from "@/screens/TextbookParts";
import { colors, radius, space } from "@/theme";

const BLOCK = 40; // 서버가 한 번에 주는 쪽 수
const SAVE_AFTER = 1500; // 쪽을 넘기고 이만큼 지나면 진도 저장

type Meta = { id: string; title: string; pages: number; offset: number; toc: TocPart[] };

/**
 * 교재 보기: 옆으로 넘기기, 두 손가락 확대, 가로/세로 돌리기, 목차·쪽 이동.
 * 쪽을 한 번 톡 치면 위(제목·상태바)·아래(쪽 번호) 바를 숨겨 넓게 보고, 다시 치면 보인다.
 * 다음 쪽으로 넘기면 그 앞 쪽을 "다 본 쪽"으로 저장한다 (목차·쪽 이동으로 건너뛴 쪽은 아님).
 * preview=1 (관리자 미리 보기)이면 진도를 저장하지 않는다.
 */
export default function BookViewer() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string; page?: string; preview?: string }>();
  const preview = params.preview === "1";
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState("");
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [index, setIndex] = useState(0); // 0부터
  const [pages, setPages] = useState<Record<number, TextbookPage>>({});
  const [tocOpen, setTocOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [landscape, setLandscape] = useState(false);
  const [full, setFull] = useState(false); // 위아래 바 숨김
  const [done, setDone] = useState<Set<number>>(new Set());

  const list = useRef<FlatList<number>>(null);
  const cur = useRef(1); // 지금 보는 쪽 (1부터)
  const asked = useRef(new Set<number>());
  const pending = useRef(new Set<number>());
  const lastSaved = useRef<number | null>(null);
  const turned = useRef(false); // 쪽을 한 번이라도 넘겼나 (열기만 하고 나가면 "이어서 보기"에 남기지 않음)
  const quietUntil = useRef(0); // 화면을 돌린 직후 생기는 스크롤은 쪽 넘김으로 치지 않음
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 교재 정보
  useEffect(() => {
    const load = preview
      ? getTextbook(params.id).then((b) => ({
          meta: { id: b.id, title: b.title, pages: b.processed || b.pages, offset: b.page_offset, toc: b.toc },
          done: [] as number[],
        }))
      : getMyTextbook().then((d) => {
          if (!d.book || d.book.id !== params.id || !d.can_view) throw new Error("hidden");
          return {
            meta: { id: d.book.id, title: d.book.title, pages: d.book.pages, offset: d.book.page_offset, toc: d.toc },
            done: d.done_pages ?? [],
          };
        });
    load
      .then(({ meta: m, done: d }) => {
        const start = Math.max(1, Math.min(Number(params.page) || 1, m.pages));
        cur.current = start;
        setIndex(start - 1);
        setDone(new Set(d));
        setMeta(m);
      })
      .catch((e) => setError(e instanceof Error && e.message === "hidden" ? t("theory_hidden") : textbookError(t, e)));
  }, [params.id, params.page, preview, t]);

  // 보는 쪽 근처 그림 주소 받기 (40쪽씩)
  useEffect(() => {
    if (!meta) return;
    const want = new Set<number>();
    for (let p = index - 1; p <= index + 6; p++) {
      if (p >= 0 && p < meta.pages) want.add(Math.floor(p / BLOCK));
    }
    want.forEach((b) => {
      if (asked.current.has(b)) return;
      asked.current.add(b);
      getTextbookPages(meta.id, b * BLOCK + 1, Math.min(meta.pages, b * BLOCK + BLOCK))
        .then((r) =>
          setPages((old) => {
            const next = { ...old };
            r.items.forEach((it) => (next[it.page] = it));
            return next;
          }),
        )
        .catch(() => asked.current.delete(b)); // 다음에 다시 시도
    });
  }, [meta, index]);

  // 진도 저장
  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (preview || !meta) return;
    const d = [...pending.current];
    const last = turned.current ? cur.current : null;
    if (d.length === 0 && (last === null || last === lastSaved.current)) return;
    pending.current.clear();
    lastSaved.current = last;
    saveTextbookProgress(meta.id, d, last).catch(() => {
      d.forEach((p) => pending.current.add(p)); // 실패하면 다음에 다시
      lastSaved.current = null;
    });
  }, [meta, preview]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s !== "active" && flush());
    return () => {
      sub.remove();
      flush();
    };
  }, [flush]);

  // 화면을 나가면 다시 세로로
  useEffect(
    () => () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => null);
    },
    [],
  );

  const turnedTo = (q: number) => {
    turned.current = true;
    if (q === cur.current + 1 && !done.has(cur.current)) {
      // 다음 쪽으로 넘김 → 앞 쪽 다 봄
      pending.current.add(cur.current);
      const p = cur.current;
      setDone((old) => new Set(old).add(p));
    }
    cur.current = q;
    setIndex(q - 1);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_AFTER);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!size.w || !meta || Date.now() < quietUntil.current) return;
    const q = Math.max(1, Math.min(meta.pages, Math.round(e.nativeEvent.contentOffset.x / size.w) + 1));
    if (q !== cur.current) turnedTo(q);
  };

  const step = (d: 1 | -1) => {
    if (!meta) return;
    const q = cur.current + d;
    if (q < 1 || q > meta.pages) return;
    turnedTo(q);
    list.current?.scrollToIndex({ index: q - 1, animated: true });
  };

  /** 목차·쪽 이동: 건너뛴 쪽은 다 본 것으로 치지 않는다 */
  const jump = (pdfPage: number) => {
    if (!meta) return;
    const q = Math.max(1, Math.min(meta.pages, pdfPage));
    cur.current = q;
    setIndex(q - 1);
    setTocOpen(false);
    quietUntil.current = Date.now() + 400;
    list.current?.scrollToIndex({ index: q - 1, animated: false });
  };

  const rotate = () => {
    const next = !landscape;
    setLandscape(next);
    ScreenOrientation.lockAsync(
      next ? ScreenOrientation.OrientationLock.LANDSCAPE : ScreenOrientation.OrientationLock.PORTRAIT_UP,
    ).catch(() => null);
  };

  const toggleFull = useCallback(() => setFull((f) => !f), []);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) {
      quietUntil.current = Date.now() + 600;
      setSize({ w: width, h: height });
    }
  };

  // 화면이 돌아가 폭이 바뀌면 보던 쪽으로 다시 맞춘다
  useEffect(() => {
    if (!size.w || !meta) return;
    quietUntil.current = Date.now() + 600;
    const h = setTimeout(() => list.current?.scrollToIndex({ index: cur.current - 1, animated: false }), 50);
    return () => clearTimeout(h);
  }, [size.w, meta]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }
  if (!meta) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const pageNo = index + 1;
  const printedNo = pageNo - meta.offset;
  const fitWidth = size.w > size.h; // 가로 화면이면 폭에 맞추고 위아래로 읽기

  return (
    <View style={styles.root}>
      <Stack.Screen
        options={{
          title: meta.title,
          headerShown: !full,
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {preview ? null : (
                <Pressable
                  onPress={() => router.push(`/tutor?page=${pageNo}`)}
                  hitSlop={12}
                  style={{ paddingHorizontal: space.sm }}
                  accessibilityLabel={t("tutor_askHere")}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={23} color={colors.primary} />
                </Pressable>
              )}
              <Pressable onPress={() => setTocOpen(true)} hitSlop={12} style={{ paddingHorizontal: space.sm }}>
                <Ionicons name="list-outline" size={24} color={colors.text} />
              </Pressable>
            </View>
          ),
        }}
      />
      <StatusBar hidden={full} />
      {preview && !full ? <Text style={styles.previewBar}>{t("tb_previewBar")}</Text> : null}
      <View style={{ flex: 1 }} onLayout={onLayout}>
        {size.w > 0 ? (
          <FlatList
            ref={list}
            key={fitWidth ? "wide" : "tall"}
            data={Array.from({ length: meta.pages }, (_, i) => i + 1)}
            keyExtractor={(p) => String(p)}
            horizontal
            pagingEnabled
            scrollEnabled={!zoomed}
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={cur.current - 1}
            getItemLayout={(_, i) => ({ length: size.w, offset: size.w * i, index: i })}
            onScroll={onScroll}
            scrollEventThrottle={32}
            windowSize={3}
            initialNumToRender={2}
            maxToRenderPerBatch={2}
            extraData={pages}
            renderItem={({ item }) => {
              const pg = pages[item];
              return pg?.url ? (
                <ZoomablePage
                  uri={pg.url}
                  cacheKey={`${meta.id}-${pg.key}`}
                  width={size.w}
                  height={size.h}
                  ratio={pg.width ? pg.height / pg.width : 1.414}
                  fitWidth={fitWidth}
                  onZoom={setZoomed}
                  onTap={toggleFull}
                />
              ) : (
                <View style={[styles.center, { width: size.w, height: size.h }]}>
                  <ActivityIndicator color={colors.primary} />
                </View>
              );
            }}
          />
        ) : null}
      </View>

      {full ? null : (
        <SafeAreaView edges={["bottom", "left", "right"]} style={styles.bar}>
          <Pressable onPress={() => step(-1)} hitSlop={10} disabled={pageNo <= 1} style={styles.arrow}>
            <Ionicons name="chevron-back" size={26} color={pageNo <= 1 ? colors.faint : colors.text} />
          </Pressable>
          <Pressable onPress={() => setTocOpen(true)} style={{ alignItems: "center", flex: 1 }}>
            <Text style={styles.pageText}>
              {t("viewer_page", { page: printedNo })}
              {done.has(pageNo) ? <Text style={styles.doneMark}>{"  ✓ " + t("viewer_doneMark")}</Text> : null}
            </Text>
            <Text style={styles.small}>
              {t("viewer_pdfPage", { page: pageNo, pages: meta.pages })}
              {preview ? "" : "  ·  " + t("viewer_readCount", { done: done.size })}
            </Text>
          </Pressable>
          <Pressable onPress={rotate} hitSlop={10} style={styles.arrow} accessibilityLabel={t("viewer_rotate")}>
            <Ionicons name={landscape ? "phone-portrait-outline" : "phone-landscape-outline"} size={22} color={colors.text} />
          </Pressable>
          <Pressable onPress={() => step(1)} hitSlop={10} disabled={pageNo >= meta.pages} style={styles.arrow}>
            <Ionicons name="chevron-forward" size={26} color={pageNo >= meta.pages ? colors.faint : colors.text} />
          </Pressable>
        </SafeAreaView>
      )}
      {fitWidth || full ? null : <Text style={styles.hint}>{t("viewer_hint")}</Text>}

      <TocSheet visible={tocOpen} meta={meta} current={pageNo} onJump={jump} onClose={() => setTocOpen(false)} />
    </View>
  );
}

/** 목차 + 쪽 번호로 이동 */
function TocSheet({
  visible,
  meta,
  current,
  onJump,
  onClose,
}: {
  visible: boolean;
  meta: Meta;
  current: number;
  onJump: (pdfPage: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [go, setGo] = useState("");
  const pdf = (p: number | null | undefined) => (p === null || p === undefined ? null : p + meta.offset);
  const goTo = () => {
    const n = Number(go.replace(/[^0-9]/g, ""));
    if (n) onJump(n + meta.offset);
    setGo("");
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.sheetBack}>
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{t("viewer_toc")}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.goRow}>
            <TextInput
              value={go}
              onChangeText={setGo}
              placeholder={t("viewer_goPh")}
              placeholderTextColor={colors.faint}
              keyboardType="number-pad"
              returnKeyType="go"
              onSubmitEditing={goTo}
              style={styles.goInput}
              maxLength={4}
            />
            <Pressable onPress={goTo} style={styles.goBtn}>
              <Text style={styles.goText}>{t("viewer_go")}</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: space.xl }}>
            {meta.toc.length === 0 ? <Text style={styles.small}>{t("theory_noToc")}</Text> : null}
            {meta.toc.map((part, pi) => (
              <View key={pi}>
                <TocRow level={0} title={part.title} page={part.page} target={pdf(part.page)} current={current} onJump={onJump} />
                {part.chapters.map((ch, ci) => (
                  <View key={ci}>
                    <TocRow level={1} title={ch.title} page={ch.page} target={pdf(ch.page)} current={current} onJump={onJump} />
                    {ch.sections.map((s, si) => (
                      <TocRow key={si} level={2} title={s.title} page={s.page} target={pdf(s.page)} current={current} onJump={onJump} />
                    ))}
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function TocRow({
  level,
  title,
  page,
  target,
  onJump,
}: {
  level: number;
  title: string;
  page: number | null;
  target: number | null;
  current: number;
  onJump: (p: number) => void;
}) {
  return (
    <Pressable
      onPress={() => target && onJump(target)}
      disabled={!target}
      style={({ pressed }) => [styles.tocRow, { paddingLeft: level * 16 }, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.tocText, level === 0 && styles.tocPart, level === 2 && { color: colors.muted }]} numberOfLines={2}>
        {title}
      </Text>
      {page !== null ? <Text style={styles.small}>{page}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: space.lg },
  error: { color: colors.danger, textAlign: "center" },
  previewBar: { color: colors.warning, fontSize: 12, textAlign: "center", paddingVertical: 4, backgroundColor: colors.primaryDim },
  bar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, paddingHorizontal: space.md, paddingTop: space.sm },
  arrow: { padding: space.sm },
  pageText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  doneMark: { color: colors.success, fontSize: 13, fontWeight: "600" },
  small: { color: colors.muted, fontSize: 12 },
  hint: { color: colors.faint, fontSize: 11, textAlign: "center", backgroundColor: colors.card, paddingBottom: 4 },
  sheetBack: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" },
  sheet: { maxHeight: "80%", backgroundColor: colors.card, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg, gap: space.md },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  goRow: { flexDirection: "row", gap: space.sm },
  goInput: { flex: 1, color: colors.text, backgroundColor: colors.cardAlt, borderRadius: radius.sm, paddingHorizontal: space.md, paddingVertical: 8, fontSize: 15 },
  goBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingHorizontal: space.lg, justifyContent: "center" },
  goText: { color: colors.text, fontWeight: "700" },
  tocRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tocText: { color: colors.text, fontSize: 14, flex: 1 },
  tocPart: { color: colors.primary, fontWeight: "700", fontSize: 15 },
});
