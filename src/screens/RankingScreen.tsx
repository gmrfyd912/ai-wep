import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar, BeadStrip } from "@/components/Avatar";
import { Body, Card, Screen } from "@/components/ui";
import {
  getRanking,
  listCourses,
  type Course,
  type RankPeriod,
  type RankRow,
} from "@/lib/api";
import { PROCESSES, WORK_TYPES, positionsOf, type WorkType } from "@/lib/weld";
import { useSession } from "@/state/session";
import { colors, radius, space } from "@/theme";

const MEDAL = ["🥇", "🥈", "🥉"];

/** 랭킹 필터 (박사 2026-11-22): 기본 전체·전과정·종합·전체·전체, 마지막 선택을 기억 (로그아웃해도 남음) */
type Filters = {
  work: WorkType | "";
  course: string;
  period: RankPeriod;
  proc: string;
  pos: string;
};
const DEFAULT: Filters = {
  work: "",
  course: "all",
  period: "all",
  proc: "",
  pos: "",
};
const KEY = "aiwep.rankingFilters";
let saved: Filters | null = null; // 앱이 켜져 있는 동안은 바로 쓰고, 처음엔 저장해 둔 값을 읽는다

/** 랭킹: 교육생 순위 (기간 안 최고 점수). 기본은 전체·전과정·종합·전체·전체.
 * 필터는 작은 버튼 한두 줄(누르면 선택지 창). 공정·자세를 고르면 그것끼리만 비교. 사람을 누르면 그 사람의 기록 전체 */
export function RankingScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const mine = user?.courses?.map((c) => c.id) ?? [];
  const [courses, setCourses] = useState<Course[]>([]);
  const [f, setF] = useState<Filters | null>(saved);
  const [data, setData] = useState<{
    rows: RankRow[];
    me: RankRow | null;
    total: number;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const req = useRef(0);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    if (!saved) {
      AsyncStorage.getItem(KEY)
        .then((v) => {
          const got = v
            ? { ...DEFAULT, ...(JSON.parse(v) as Partial<Filters>) }
            : DEFAULT;
          saved = got;
          setF(got);
        })
        .catch(() => setF((saved = DEFAULT)));
    }
    listCourses()
      .then(setCourses)
      .catch(() => null);
  }, []);

  const change = (patch: Partial<Filters>) => {
    if (!f) return;
    const next = { ...f, ...patch };
    // 고른 재료 형상에 없는 자세면 자세는 전체로
    if (next.pos && !positionsOf(next.work).includes(next.pos)) next.pos = "";
    saved = next;
    setF(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => null);
  };

  // 저장된 반이 없어졌으면 전과정으로
  const course =
    f &&
    (f.course === "all" ||
      !courses.length ||
      courses.some((c) => c.id === f.course))
      ? f.course
      : "all";

  const load = useCallback(() => {
    if (!f) return;
    const n = ++req.current;
    setFailed(false);
    setData(null);
    getRanking({
      process: f.proc,
      position: f.pos,
      period: f.period,
      course,
      work_type: f.work,
    })
      .then((r) => n === req.current && setData(r))
      .catch(() => n === req.current && setFailed(true));
  }, [f, course]);
  useFocusEffect(load);

  const courseOptions = [
    ...courses
      .filter((c) => mine.includes(c.id))
      .map((c) => ({
        value: c.id,
        label: t("gallery_myCourse", { name: c.name }),
      })),
    { value: "all", label: t("ranking_allCourses") },
    ...courses
      .filter((c) => !mine.includes(c.id))
      .map((c) => ({ value: c.id, label: c.name })),
  ];
  type Group = {
    key: string;
    title: string;
    value: string;
    def: string;
    current: string;
    options: { value: string; label: string }[];
    pick: (v: string) => void;
  };
  const mk = (
    key: string,
    title: string,
    value: string,
    def: string,
    options: { value: string; label: string }[],
    pick: (v: string) => void,
  ): Group => ({
    key,
    title,
    value,
    def,
    options,
    pick,
    current:
      options.find((o) => o.value === value)?.label ?? options[0]?.label ?? "",
  });
  const all = { value: "", label: t("common_all") };
  const groups: Group[] = f
    ? [
        mk(
          "work",
          t("ranking_fWork"),
          f.work,
          "",
          [
            all,
            ...WORK_TYPES.map((w) => ({ value: w, label: t(`work_${w}`) })),
          ],
          (v) => change({ work: v as WorkType | "" }),
        ),
        mk("course", t("ranking_fCourse"), course, "all", courseOptions, (v) =>
          change({ course: v }),
        ),
        mk(
          "period",
          t("ranking_fPeriod"),
          f.period,
          "all",
          [
            { value: "all", label: t("ranking_all") },
            { value: "day", label: t("ranking_day") },
            { value: "week", label: t("ranking_week") },
            { value: "month", label: t("ranking_month") },
          ],
          (v) => change({ period: v as RankPeriod }),
        ),
        mk(
          "proc",
          t("upload_process"),
          f.proc,
          "",
          [all, ...PROCESSES.map((v) => ({ value: v, label: v }))],
          (v) => change({ proc: v }),
        ),
        mk(
          "pos",
          t("upload_position"),
          f.pos,
          "",
          [all, ...positionsOf(f.work).map((v) => ({ value: v, label: v }))],
          (v) => change({ pos: v }),
        ),
      ]
    : [];
  const meShown =
    data?.me && data.rows.some((r) => r.user_id === data.me!.user_id);

  return (
    <Screen>
      {!f ? <ActivityIndicator color={colors.primary} /> : null}
      {f ? (
        <View style={styles.pills}>
          {groups.map((g) => (
            <Pressable
              key={g.key}
              onPress={() => setOpen(g.key)}
              style={[styles.pill, g.value !== g.def && styles.pillOn]}
              accessibilityLabel={`${g.title} ${g.current}`}
            >
              <Text style={styles.pillTitle}>{g.title}</Text>
              <Text
                style={[
                  styles.pillValue,
                  g.value !== g.def && { color: colors.primary },
                ]}
                numberOfLines={1}
              >
                {g.current}
              </Text>
              <Ionicons
                name="chevron-down"
                size={14}
                color={g.value !== g.def ? colors.primary : colors.muted}
              />
            </Pressable>
          ))}
        </View>
      ) : null}
      <OptionSheet
        group={groups.find((g) => g.key === open) ?? null}
        onPick={(v) => {
          const g = groups.find((x) => x.key === open);
          setOpen(null);
          if (g) g.pick(v);
        }}
        onClose={() => setOpen(null)}
      />

      {failed ? <Text style={styles.error}>{t("error_network")}</Text> : null}
      {!data && !failed ? <ActivityIndicator color={colors.primary} /> : null}
      {data?.me && !meShown ? (
        <RankCard r={data.me} me mixed={!f?.work || !f?.proc || !f?.pos} />
      ) : null}
      {data && data.rows.length === 0 ? (
        <Body muted>{t("ranking_empty")}</Body>
      ) : null}
      {data?.rows.map((r) => (
        <RankCard
          key={r.user_id}
          r={r}
          me={r.user_id === user?.id}
          mixed={!f?.work || !f?.proc || !f?.pos}
        />
      ))}
      {data && data.total > data.rows.length ? (
        <Text style={styles.hint}>
          {t("ranking_top", { n: data.rows.length, total: data.total })}
        </Text>
      ) : null}
      <Text style={styles.hint}>
        {t(f && f.work && f.proc && f.pos ? "ranking_rule" : "ranking_ruleAll")}
      </Text>
    </Screen>
  );
}

/** mixed: 공정·자세 전체로 볼 때는 최고 점수를 낸 공정·자세도 함께 보여 준다 */
function RankCard({
  r,
  me,
  mixed,
}: {
  r: RankRow;
  me?: boolean;
  mixed?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const date = new Date(r.created_at).toLocaleDateString(i18n.language, {
    month: "numeric",
    day: "numeric",
  });
  const c =
    r.score >= 85
      ? colors.success
      : r.score >= 70
        ? colors.warning
        : colors.danger;
  return (
    <Card
      style={me ? { ...styles.row, ...styles.me } : styles.row}
      onPress={() =>
        router.push({
          pathname: "/student-view/[id]",
          params: { id: r.user_id },
        })
      }
    >
      <View style={styles.top}>
        <Text style={[styles.rank, r.rank <= 3 && styles.medal]}>
          {r.rank <= 3
            ? MEDAL[r.rank - 1]
            : t("ranking_rank", { rank: r.rank })}
        </Text>
        <Avatar
          url={r.avatar_url}
          cacheKey={r.avatar_key}
          name={r.name}
          size={38}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {r.name}
            {me ? <Text style={styles.meTag}> {t("ranking_me")}</Text> : null}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {r.courses.join(", ")}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {mixed
              ? `${[r.work_type === "pipe" ? t("work_pipe") : t("work_plate"), r.process, r.position].filter(Boolean).join(" · ")} · `
              : ""}
            {t("ranking_bestOn", { date })}
          </Text>
        </View>
        <Text style={[styles.score, { color: c }]}>
          {t("common_points", { score: r.score })}
        </Text>
      </View>
      <BeadStrip url={r.bead_url} cacheKey={r.bead_key} ratio={r.bead_ratio} />
    </Card>
  );
}

/** 필터 버튼을 누르면 아래에서 올라오는 선택지 창 */
export function OptionSheet({
  group,
  onPick,
  onClose,
}: {
  group: {
    title: string;
    value: string;
    options: { value: string; label: string }[];
  } | null;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      visible={!!group}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => null}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{group?.title}</Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityLabel={t("common_close")}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView style={{ maxHeight: 420 }}>
            {group?.options.map((o) => {
              const on = o.value === group.value;
              return (
                <Pressable
                  key={o.value || "_all"}
                  onPress={() => onPick(o.value)}
                  style={({ pressed }) => [
                    styles.option,
                    pressed && { backgroundColor: colors.primaryDim },
                  ]}
                >
                  <Text style={[styles.optionText, on && styles.optionOn]}>
                    {o.label}
                  </Text>
                  {on ? (
                    <Ionicons
                      name="checkmark"
                      size={20}
                      color={colors.primary}
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.faint, fontSize: 12 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    maxWidth: "100%",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  pillOn: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  pillTitle: { color: colors.faint, fontSize: 12 },
  pillValue: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
    flexShrink: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  sheetHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: "800" },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: space.xs,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: { color: colors.text, fontSize: 15 },
  optionOn: { color: colors.primary, fontWeight: "800" },
  error: { color: colors.danger },
  row: { gap: space.sm, paddingVertical: space.md },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  me: { borderColor: colors.primary, borderWidth: 1 },
  rank: {
    color: colors.muted,
    fontWeight: "800",
    fontSize: 15,
    minWidth: 40,
    textAlign: "center",
  },
  medal: { fontSize: 26 },
  name: { color: colors.text, fontWeight: "700", fontSize: 15 },
  meTag: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 12 },
  score: { fontWeight: "800", fontSize: 16 },
});
