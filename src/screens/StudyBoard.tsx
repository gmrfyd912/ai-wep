import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { AppButton, Body, Card, Chips, Screen } from "@/components/ui";
import {
  answerTutorQuiz,
  getStudyBoard,
  getStudyBoardUser,
  listCourses,
  type BoardCourse,
  type BoardGrowth,
  type BoardRow,
  type BoardSort,
  type BoardStaff,
  type BoardTopic,
  type BoardUnit,
  type BoardWrong,
  type Course,
  type DailyResult,
  type RankPeriod,
  type StudyBoard,
} from "@/lib/api";
import { OptionSheet } from "@/screens/RankingScreen";
import { ProgressBar } from "@/screens/TextbookParts";
import { useSession } from "@/state/session";
import { colors, radius, space } from "@/theme";

const MEDAL = ["🥇", "🥈", "🥉"];
const MARK = ["①", "②", "③", "④"];
const OX = ["O", "X"];

type Tab = "solve" | "topics" | "wrong" | "units" | "courses" | "staff";
/** 고른 것은 기억 (실습 랭킹과 같은 방식). course "" = 아직 안 고름 → 우리 반(없으면 전체) */
type Filters = { course: string; period: RankPeriod; sort: BoardSort; tab: Tab };
const DEFAULT: Filters = { course: "", period: "week", sort: "solved", tab: "solve" };
const KEY = "aiwep.studyBoardFilters";
let saved: Filters | null = null;

const rateColor = (r: number) => (r >= 80 ? colors.success : r >= 60 ? colors.warning : colors.danger);

/** T4 학습 보드: 모든 사용자가 보는 문제 풀이 순위·많이 물어본 질문·많이 틀린 문제·장별 정답률 */
export function StudyBoardScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const mine = user?.courses?.map((c) => c.id) ?? [];
  const [courses, setCourses] = useState<Course[]>([]);
  const [f, setF] = useState<Filters | null>(saved);
  const [data, setData] = useState<StudyBoard | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const req = useRef(0);

  useEffect(() => {
    if (!saved) {
      AsyncStorage.getItem(KEY)
        .then((v) => setF((saved = v ? { ...DEFAULT, ...(JSON.parse(v) as Partial<Filters>) } : DEFAULT)))
        .catch(() => setF((saved = DEFAULT)));
    }
    listCourses()
      .then(setCourses)
      .catch(() => null);
  }, []);

  const change = (patch: Partial<Filters>) => {
    if (!f) return;
    const next = { ...f, ...patch };
    saved = next;
    setF(next);
    AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => null);
  };

  // 처음엔 우리 반, 저장된 반이 없어졌으면 전체
  const course = !f
    ? "all"
    : f.course === ""
      ? (mine[0] ?? "all")
      : f.course === "all" || !courses.length || courses.some((c) => c.id === f.course)
        ? f.course
        : "all";

  const load = useCallback(() => {
    if (!f) return;
    const n = ++req.current;
    setFailed(false);
    setData(null);
    getStudyBoard({ course, period: f.period, sort: f.sort, lang: i18n.language })
      .then((r) => n === req.current && setData(r))
      .catch(() => n === req.current && setFailed(true));
    // 탭만 바꿀 때는 다시 받지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, f?.period, f?.sort, i18n.language]);
  useFocusEffect(load);

  const courseOptions = [
    ...courses.filter((c) => mine.includes(c.id)).map((c) => ({ value: c.id, label: t("gallery_myCourse", { name: c.name }) })),
    { value: "all", label: t("ranking_allCourses") },
    ...courses.filter((c) => !mine.includes(c.id)).map((c) => ({ value: c.id, label: c.name })),
  ];
  const periodOptions = [
    { value: "day", label: t("ranking_day") },
    { value: "week", label: t("ranking_week") },
    { value: "month", label: t("ranking_month") },
    { value: "all", label: t("ranking_all") },
  ];
  const groups = f
    ? [
        { key: "course", title: t("ranking_fCourse"), value: course, options: courseOptions, pick: (v: string) => change({ course: v }) },
        { key: "period", title: t("ranking_fPeriod"), value: f.period, options: periodOptions, pick: (v: string) => change({ period: v as RankPeriod }) },
      ]
    : [];
  const sheet = groups.find((g) => g.key === open) ?? null;
  const isStaff = !!user && user.role !== "student";
  // 교육생은 교사용 칸이 없으니 첫 칸으로
  const tab: Tab = f && (f.tab !== "staff" || isStaff) ? f.tab : "solve";

  return (
    <Screen>
      {!f ? <ActivityIndicator color={colors.primary} /> : null}
      {f ? (
        <View style={styles.pills}>
          {groups.map((g) => (
            <Pressable key={g.key} onPress={() => setOpen(g.key)} style={styles.pill} accessibilityLabel={g.title}>
              <Text style={styles.pillTitle}>{g.title}</Text>
              <Text style={styles.pillValue} numberOfLines={1}>
                {g.options.find((o) => o.value === g.value)?.label ?? ""}
              </Text>
              <Ionicons name="chevron-down" size={14} color={colors.muted} />
            </Pressable>
          ))}
        </View>
      ) : null}
      <OptionSheet
        group={sheet}
        onPick={(v) => {
          setOpen(null);
          sheet?.pick(v);
        }}
        onClose={() => setOpen(null)}
      />

      {failed ? <Text style={styles.error}>{t("error_network")}</Text> : null}
      {!data && !failed && f ? <ActivityIndicator color={colors.primary} /> : null}
      {data && !data.book ? <Body muted>{t("sb_noBook")}</Body> : null}
      {data?.hidden ? <Body muted>{t("theory_hidden")}</Body> : null}

      {data?.book && !data.hidden && f ? (
        <>
          {data.me ? <MeCard me={data.me} total={data.total} sort={f.sort} minRate={data.min_rate_solved} /> : null}
          <Chips<Tab>
            options={[
              { value: "solve", label: t("sb_tabSolve") },
              { value: "topics", label: t("sb_tabTopics") },
              { value: "wrong", label: t("sb_tabWrong") },
              { value: "units", label: t("sb_tabUnits") },
              { value: "courses", label: t("sb_tabCourses") },
              ...(isStaff ? [{ value: "staff" as Tab, label: t("sb_tabStaff") }] : []),
            ]}
            value={tab}
            onChange={(v) => change({ tab: v })}
          />
          {tab === "solve" ? (
            <SolveTab data={data} sort={f.sort} period={f.period} onSort={(v) => change({ sort: v })} />
          ) : null}
          {tab === "topics" ? <TopicsTab data={data} /> : null}
          {tab === "wrong" ? <WrongTab data={data} /> : null}
          {tab === "units" ? <UnitsTab units={data.units} /> : null}
          {tab === "courses" ? <CoursesTab courses={data.courses ?? []} /> : null}
          {tab === "staff" && data.staff ? <StaffTab staff={data.staff} /> : null}
        </>
      ) : null}
    </Screen>
  );
}

/** 맨 위 '나' 카드: 순위·푼 수·정답률·연속 일수·약한 장 */
function MeCard({ me, total, sort, minRate }: { me: BoardRow; total: number; sort: BoardSort; minRate: number }) {
  const { t } = useTranslation();
  return (
    <Card style={styles.meCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.meTitle}>{t("ranking_me")}</Text>
        <Text style={styles.meRank}>
          {me.rank ? t("sb_meRank", { rank: me.rank, total }) : t("sb_meNoRank")}
        </Text>
      </View>
      <Text style={styles.meLine}>
        {t("sb_solved", { n: me.solved })} · {t("sb_points", { n: me.score })} · {t("sb_rate", { n: me.rate })}
        {me.streak > 0 ? ` · ${t("sb_streak", { n: me.streak })}` : ""}
      </Text>
      {sort === "rate" && me.rank === null ? <Text style={styles.small}>{t("sb_meNeedMore", { n: minRate })}</Text> : null}
      <Text style={styles.small}>
        {me.weak_unit ? t("sb_weak", { title: me.weak_unit.title, rate: me.weak_unit.rate }) : t("sb_noWeak")}
      </Text>
    </Card>
  );
}

function SolveTab({ data, sort, period, onSort }: { data: StudyBoard; sort: BoardSort; period: RankPeriod; onSort: (v: BoardSort) => void }) {
  const { t } = useTranslation();
  const { user } = useSession();
  return (
    <>
      {data.growth?.length ? <GrowthCard growth={data.growth} min={data.min_growth} /> : null}
      <Chips<BoardSort>
        options={[
          { value: "solved", label: t("sb_sortSolved") },
          { value: "score", label: t("sb_sortScore") },
          { value: "rate", label: t("sb_sortRate") },
        ]}
        value={sort}
        onChange={onSort}
      />
      {data.rows.length === 0 ? <Body muted>{t("sb_emptySolve")}</Body> : null}
      {data.rows.map((r) => (
        <SolverRow key={r.user_id} r={r} me={r.user_id === user?.id} sort={sort} period={period} />
      ))}
      {data.total > data.rows.length ? <Text style={styles.hint}>{t("ranking_top", { n: data.rows.length, total: data.total })}</Text> : null}
      <Text style={styles.hint}>{t("sb_ruleSolve")}</Text>
      {sort === "rate" ? <Text style={styles.hint}>{t("sb_ruleRate", { n: data.min_rate_solved })}</Text> : null}
    </>
  );
}

function SolverRow({ r, me, sort, period }: { r: BoardRow; me: boolean; sort: BoardSort; period: RankPeriod }) {
  const { t } = useTranslation();
  const [units, setUnits] = useState<BoardUnit[] | null | "open">(null);
  const toggle = () => {
    if (units) return setUnits(null);
    setUnits("open");
    getStudyBoardUser(r.user_id, period)
      .then((d) => setUnits(d.units))
      .catch(() => setUnits(null));
  };
  const rank = r.rank ?? 0;
  // 지금 정렬 기준 값을 크게
  const big = sort === "score" ? t("sb_points", { n: r.score }) : sort === "rate" ? `${r.rate}%` : t("sb_solved", { n: r.solved });
  return (
    <Card style={me ? { ...styles.row, ...styles.me } : styles.row} onPress={toggle}>
      <View style={styles.top}>
        <Text style={[styles.rank, rank > 0 && rank <= 3 && styles.medal]}>
          {rank > 0 && rank <= 3 ? MEDAL[rank - 1] : t("ranking_rank", { rank })}
        </Text>
        <Avatar url={r.avatar_url} cacheKey={r.avatar_key} name={r.name} size={38} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {r.name}
            {me ? <Text style={styles.meTag}> {t("ranking_me")}</Text> : null}
            {r.streak > 0 ? <Text style={styles.streak}> {t("sb_streak", { n: r.streak })}</Text> : null}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {r.courses.join(", ")}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {t("sb_src", { daily: r.daily, tutor: r.tutor, live: r.live ?? 0 })}
          </Text>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={styles.big}>{big}</Text>
          <Text style={styles.meta}>
            {sort === "solved" ? `${t("sb_points", { n: r.score })} · ${r.rate}%` : sort === "score" ? `${t("sb_solved", { n: r.solved })} · ${r.rate}%` : `${t("sb_solved", { n: r.solved })}`}
          </Text>
        </View>
      </View>
      {units === "open" ? <ActivityIndicator color={colors.primary} /> : null}
      {Array.isArray(units) ? (
        <View style={{ gap: space.sm }}>
          <Text style={styles.small}>{t("sb_userUnits", { name: r.name })}</Text>
          <UnitBars units={units} />
        </View>
      ) : null}
    </Card>
  );
}

/** 이번 주 성장왕: 지난주보다 정답률이 가장 많이 오른 교육생 */
function GrowthCard({ growth, min }: { growth: BoardGrowth[]; min: number }) {
  const { t } = useTranslation();
  return (
    <Card style={styles.growth}>
      <Text style={styles.growthTitle}>{t("sb_growthTitle")}</Text>
      {growth.map((g, i) => (
        <Pressable key={g.user_id} style={styles.top} onPress={() => router.push({ pathname: "/student-view/[id]", params: { id: g.user_id } })}>
          <Text style={styles.growthRank}>{MEDAL[i]}</Text>
          <Avatar url={g.avatar_url} cacheKey={g.avatar_key} name={g.name} size={30} />
          <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
            {g.name}
          </Text>
          <Text style={styles.meta}>
            {g.last_rate}% → {g.this_rate}%
          </Text>
          <Text style={styles.growthDelta}>+{g.delta}</Text>
        </Pressable>
      ))}
      <Text style={styles.hint}>{t("sb_growthRule", { n: min })}</Text>
    </Card>
  );
}

type CourseSort = "avg_score" | "participation" | "avg_rate";

/** 과정 대항전: 반 인원이 달라서 1인 평균으로 비교 */
function CoursesTab({ courses }: { courses: BoardCourse[] }) {
  const { t } = useTranslation();
  const { user } = useSession();
  const mine = user?.courses?.map((c) => c.id) ?? [];
  const [sort, setSort] = useState<CourseSort>("avg_score");
  const list = [...courses].sort((a, b) => b[sort] - a[sort] || b.avg_score - a.avg_score);
  return (
    <>
      <Chips<CourseSort>
        options={[
          { value: "avg_score", label: t("sb_cSortScore") },
          { value: "participation", label: t("sb_cSortPart") },
          { value: "avg_rate", label: t("sb_cSortRate") },
        ]}
        value={sort}
        onChange={setSort}
      />
      {list.length === 0 ? <Body muted>{t("sb_emptyCourses")}</Body> : null}
      {list.map((c, i) => (
        <Card key={c.course_id} style={mine.includes(c.course_id) ? { ...styles.row, ...styles.me } : styles.row}>
          <View style={styles.top}>
            <Text style={[styles.rank, i < 3 && styles.medal]}>{i < 3 ? MEDAL[i] : t("ranking_rank", { rank: i + 1 })}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{c.name}</Text>
              <Text style={styles.meta}>{t("sb_cMembers", { n: c.students, active: c.active })}</Text>
            </View>
            <Text style={styles.big}>
              {sort === "participation" ? `${c.participation}%` : sort === "avg_rate" ? `${c.avg_rate}%` : t("sb_points", { n: c.avg_score })}
            </Text>
          </View>
          <View style={styles.statRow}>
            <Stat label={t("sb_cPart")} value={`${c.participation}%`} />
            <Stat label={t("sb_cAvgSolved")} value={String(c.avg_solved)} />
            <Stat label={t("sb_cAvgRate")} value={`${c.avg_rate}%`} />
            <Stat label={t("sb_cAvgScore")} value={String(c.avg_score)} />
          </View>
        </Card>
      ))}
      <Text style={styles.hint}>{t("sb_ruleCourses")}</Text>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** 교사·관리자 전용: 안 푼 학생, 반별 약한 장, 최근 신고 */
function StaffTab({ staff }: { staff: BoardStaff }) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const admin = user?.role === "admin";
  const date = (v: string) => new Date(v).toLocaleDateString(i18n.language, { month: "numeric", day: "numeric" });
  return (
    <>
      <Text style={styles.note}>{t("sb_staffOnly")}</Text>
      <Card style={styles.row}>
        <Text style={styles.sectionHead}>{t("sb_idleTitle", { n: staff.idle.length })}</Text>
        {staff.idle.length === 0 ? <Text style={styles.small}>{t("sb_idleNone")}</Text> : null}
        {staff.idle.map((u) => (
          <Pressable key={u.user_id} style={styles.rowBetween} onPress={() => router.push({ pathname: "/student-view/[id]", params: { id: u.user_id } })}>
            <Text style={styles.name}>{u.name}</Text>
            <Text style={styles.meta}>{u.last_day ? t("sb_idleLast", { date: date(u.last_day) }) : t("sb_idleNever")}</Text>
          </Pressable>
        ))}
      </Card>
      {staff.live_missed ? (
        <Card style={styles.row}>
          <Text style={styles.sectionHead}>{t("sb_liveMissedTitle", { n: staff.live_missed.length })}</Text>
          {staff.live_missed.length === 0 ? <Text style={styles.small}>{t("sb_liveMissedNone")}</Text> : null}
          {staff.live_missed.map((u) => (
            <Pressable key={u.user_id} style={styles.rowBetween} onPress={() => router.push({ pathname: "/student-view/[id]", params: { id: u.user_id } })}>
              <Text style={styles.name}>{u.name}</Text>
              <Text style={styles.meta}>{t("sb_liveMissed", { n: u.missed, total: u.total })}</Text>
            </Pressable>
          ))}
        </Card>
      ) : null}
      <Card style={styles.row}>
        <Text style={styles.sectionHead}>{t("sb_weakTitle")}</Text>
        {staff.weak.length === 0 ? <Text style={styles.small}>{t("sb_emptyUnits")}</Text> : null}
        {staff.weak.map((c) => (
          <View key={c.course_id} style={{ gap: 6 }}>
            <Text style={styles.name}>{c.name}</Text>
            <UnitBars units={c.units} />
          </View>
        ))}
      </Card>
      <Card style={styles.row}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionHead}>{t("sb_tutorReports")}</Text>
          {admin ? (
            <Pressable onPress={() => router.push("/manage/tutor-reports")} hitSlop={8}>
              <Text style={styles.link}>{t("sb_manage")}</Text>
            </Pressable>
          ) : null}
        </View>
        {staff.tutor_reports.length === 0 ? <Text style={styles.small}>{t("sb_noReports")}</Text> : null}
        {staff.tutor_reports.map((r) => (
          <View key={r.id} style={styles.report}>
            <Text style={styles.small}>“{r.question}”</Text>
            <Text style={styles.meta} numberOfLines={2}>
              {r.answer}
            </Text>
            <Text style={styles.meta}>
              {date(r.reported_at)}
              {r.report_note ? ` · ${r.report_note}` : ""}
            </Text>
          </View>
        ))}
      </Card>
      <Card style={styles.row}>
        <Text style={styles.sectionHead}>{t("sb_questionReports")}</Text>
        {staff.question_reports.length === 0 ? <Text style={styles.small}>{t("sb_noReports")}</Text> : null}
        {staff.question_reports.map((r, i) => (
          <Pressable
            key={`${r.question_id}-${i}`}
            style={styles.report}
            disabled={!admin || !r.book_id}
            onPress={() => router.push({ pathname: "/manage/questions/[bookId]", params: { bookId: r.book_id! } })}
          >
            <Text style={styles.small} numberOfLines={3}>
              {r.question}
            </Text>
            <Text style={styles.meta}>
              {date(r.created_at)}
              {r.reason ? ` · ${r.reason}` : ""}
              {admin && r.book_id ? ` · ${t("sb_manage")}` : ""}
            </Text>
          </Pressable>
        ))}
      </Card>
      <Text style={styles.hint}>{t("sb_ruleStaff")}</Text>
    </>
  );
}

function TopicsTab({ data }: { data: StudyBoard }) {
  const { t } = useTranslation();
  return (
    <>
      {data.tagging > 0 ? <Text style={styles.note}>{t("sb_tagging", { n: data.tagging })}</Text> : null}
      {data.topics.length === 0 && !data.tagging ? <Body muted>{t("sb_emptyTopics")}</Body> : null}
      {data.topics.map((tp, i) => (
        <TopicCard key={tp.topic} tp={tp} n={i + 1} bookId={data.book!.id} />
      ))}
      <Text style={styles.hint}>{t("sb_ruleTopics")}</Text>
    </>
  );
}

function TopicCard({ tp, n, bookId }: { tp: BoardTopic; n: number; bookId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Card style={styles.row} onPress={() => setOpen(!open)}>
      <View style={styles.top}>
        <Text style={[styles.rank, n <= 3 && styles.medal]}>{n <= 3 ? MEDAL[n - 1] : t("ranking_rank", { rank: n })}</Text>
        <Text style={[styles.name, { flex: 1 }]}>{tp.topic}</Text>
        <Text style={styles.meta}>{t("sb_topicCount", { users: tp.users, count: tp.count })}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color={colors.faint} />
      </View>
      {open ? (
        <View style={{ gap: space.sm }}>
          {tp.question ? (
            <Text style={styles.small}>
              {t("sb_topicQuestion")}: “{tp.question}”
            </Text>
          ) : null}
          {tp.answer ? (
            <View style={styles.answerBox}>
              <Text style={styles.small}>{t("sb_topicAnswer")}</Text>
              <Text style={styles.answer}>{tp.answer}</Text>
            </View>
          ) : null}
          <View style={styles.chipRow}>
            {tp.pages.map((p) => (
              <Pressable key={p.page} style={styles.pageChip} onPress={() => router.push(`/book?id=${bookId}&page=${p.page}`)}>
                <Ionicons name="book-outline" size={13} color={colors.primary} />
                <Text style={styles.pageChipText}>{t("dq_openPage", { page: p.printed })}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </Card>
  );
}

function WrongTab({ data }: { data: StudyBoard }) {
  const { t } = useTranslation();
  return (
    <>
      {data.wrong.length === 0 ? <Body muted>{t("sb_emptyWrong", { n: data.min_wrong_users })}</Body> : null}
      {data.wrong.map((w, i) => (
        <WrongCard key={w.qid} w={w} n={i + 1} bookId={data.book!.id} />
      ))}
      <Text style={styles.hint}>{t("sb_ruleWrong", { n: data.min_wrong_users })}</Text>
    </>
  );
}

/** 많이 틀린 문제: 먼저 풀어 보고(OX·객관식은 웰디 문제처럼 기록), 그 뒤에 정답·가장 많이 고른 오답·해설 */
function WrongCard({ w, n, bookId }: { w: BoardWrong; n: number; bookId: string }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const q = w.item;
  const [trying, setTrying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<DailyResult | null>(null);
  const [shown, setShown] = useState(false); // 단답형·서술형 '답 보기'
  const choice = q.kind === "mc" || q.kind === "ox";
  const question = lang !== "ko" && q.tr ? q.tr.question : q.question;
  const choices = lang !== "ko" && q.tr?.choices?.length ? q.tr.choices : q.choices;
  const done = !!res || shown;
  const correctChoice = res?.correct_choice ?? q.reveal.correct_choice;
  const pick = (c: number) => {
    if (busy || res) return;
    setBusy(true);
    answerTutorQuiz(q.id, c, lang)
      .then((d) => setRes(d.result))
      .catch(() => setRes({ answer: String(c), correct: c === q.reveal.correct_choice, score: null, feedback: "", graded_by: "auto", correct_choice: q.reveal.correct_choice, model_answer: "", explanation: "", tr: null }))
      .finally(() => setBusy(false));
  };
  const tone = (i: number) => {
    if (!res) return null;
    if (i === correctChoice) return styles.optRight;
    if (String(i) === res.answer) return styles.optWrong;
    return null;
  };
  const label = (i: number) => (q.kind === "ox" ? OX[i] : MARK[i]);
  const explanation = lang !== "ko" && q.reveal.tr ? q.reveal.tr.explanation : q.reveal.explanation;
  const model = lang !== "ko" && q.reveal.tr ? q.reveal.tr.model_answer : q.reveal.model_answer;
  return (
    <Card style={styles.row}>
      <View style={styles.top}>
        <Text style={[styles.rank, n <= 3 && styles.medal]}>{n <= 3 ? MEDAL[n - 1] : t("ranking_rank", { rank: n })}</Text>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.meta} numberOfLines={1}>
            {q.unit_title}
          </Text>
          <Text style={[styles.rateLine, { color: rateColor(w.rate) }]}>
            {t("sb_wrongStat", { rate: w.rate, attempts: w.attempts, wrong: w.wrong })}
          </Text>
        </View>
      </View>
      <Text style={styles.question}>{question}</Text>
      {!trying && !done ? (
        <AppButton label={choice ? t("sb_try") : t("sb_showAnswer")} icon={choice ? "create-outline" : "eye-outline"} variant="secondary" onPress={() => (choice ? setTrying(true) : setShown(true))} />
      ) : null}
      {choice && (trying || res) ? (
        q.kind === "ox" ? (
          <View style={styles.oxRow}>
            {OX.map((o, i) => (
              <Pressable key={o} style={[styles.oxBtn, tone(i)]} onPress={() => pick(i)} disabled={!!res}>
                <Text style={styles.oxText}>{o}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          choices.map((c, i) => (
            <Pressable key={i} style={[styles.opt, tone(i)]} onPress={() => pick(i)} disabled={!!res}>
              <Text style={styles.optText}>
                {MARK[i]} {c}
              </Text>
            </Pressable>
          ))
        )
      ) : null}
      {busy ? <ActivityIndicator color={colors.primary} /> : null}
      {done ? (
        <View style={{ gap: 6 }}>
          {res ? (
            <Text style={{ color: res.correct ? colors.success : colors.danger, fontWeight: "700" }}>
              {res.correct ? t("dq_right") : t("dq_legendWrong")}
            </Text>
          ) : null}
          {choice && w.top_wrong !== null ? (
            <Text style={styles.small}>{t("sb_topWrong", { choice: label(w.top_wrong), n: w.top_wrong_n })}</Text>
          ) : null}
          {!choice && model ? (
            <Text style={styles.small}>
              {t("dq_modelAnswer")}: {model}
            </Text>
          ) : null}
          {explanation ? (
            <Text style={styles.small}>
              {t("dq_explanation")}: {explanation}
            </Text>
          ) : null}
          {q.page ? (
            <Pressable style={styles.pageChip} onPress={() => router.push(`/book?id=${bookId}&page=${q.page}`)}>
              <Ionicons name="book-outline" size={13} color={colors.primary} />
              <Text style={styles.pageChipText}>{t("dq_openPage", { page: q.printed_page })}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

function UnitsTab({ units }: { units: BoardUnit[] }) {
  const { t } = useTranslation();
  return (
    <>
      {units.length === 0 ? <Body muted>{t("sb_emptyUnits")}</Body> : <Card style={styles.row}><UnitBars units={units} /></Card>}
      <Text style={styles.hint}>{t("sb_ruleUnits")}</Text>
    </>
  );
}

function UnitBars({ units }: { units: BoardUnit[] }) {
  const { t } = useTranslation();
  if (!units.length) return <Text style={styles.small}>{t("sb_emptyUnits")}</Text>;
  return (
    <View style={{ gap: space.sm }}>
      {units.map((u) => (
        <View key={u.unit_key} style={{ gap: 4 }}>
          <View style={styles.rowBetween}>
            <Text style={styles.unitTitle} numberOfLines={2}>
              {u.title}
            </Text>
            <Text style={[styles.unitRate, { color: rateColor(u.rate) }]}>{u.rate}%</Text>
          </View>
          <ProgressBar ratio={u.rate / 100} color={rateColor(u.rate)} />
          <Text style={styles.meta}>{t("sb_unitStat", { correct: u.correct, attempts: u.attempts })}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
  hint: { color: colors.faint, fontSize: 12 },
  note: { color: colors.warning, fontSize: 12 },
  small: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, maxWidth: "100%", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  pillTitle: { color: colors.faint, fontSize: 12 },
  pillValue: { color: colors.text, fontSize: 13, fontWeight: "700", flexShrink: 1 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  meCard: { gap: 6, borderColor: colors.primary, borderWidth: 1 },
  meTitle: { color: colors.primary, fontSize: 15, fontWeight: "800" },
  meRank: { color: colors.text, fontSize: 15, fontWeight: "800" },
  meLine: { color: colors.text, fontSize: 14 },
  row: { gap: space.sm, paddingVertical: space.md },
  me: { borderColor: colors.primary, borderWidth: 1 },
  top: { flexDirection: "row", alignItems: "center", gap: space.sm },
  rank: { color: colors.muted, fontWeight: "800", fontSize: 15, minWidth: 40, textAlign: "center" },
  medal: { fontSize: 26 },
  name: { color: colors.text, fontWeight: "700", fontSize: 15 },
  meTag: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  streak: { color: colors.warning, fontSize: 12, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 12 },
  big: { color: colors.primary, fontWeight: "800", fontSize: 16 },
  answerBox: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: space.md, gap: 4 },
  answer: { color: colors.text, fontSize: 14, lineHeight: 21 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  pageChip: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4, borderWidth: 1, borderColor: colors.primary, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pageChipText: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  rateLine: { fontSize: 13, fontWeight: "700" },
  question: { color: colors.text, fontSize: 15, lineHeight: 22, fontWeight: "600" },
  oxRow: { flexDirection: "row", gap: space.md },
  oxBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingVertical: space.md, alignItems: "center", backgroundColor: colors.card },
  oxText: { color: colors.text, fontSize: 26, fontWeight: "800" },
  opt: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, padding: space.sm, backgroundColor: colors.card },
  optText: { color: colors.text, fontSize: 14 },
  optRight: { borderColor: colors.success, backgroundColor: "#12301F" },
  optWrong: { borderColor: colors.danger, backgroundColor: "#3A1414" },
  unitTitle: { color: colors.text, fontSize: 14, flex: 1 },
  growth: { gap: space.sm, borderColor: colors.warning, borderWidth: 1 },
  growthTitle: { color: colors.warning, fontSize: 15, fontWeight: "800" },
  growthRank: { fontSize: 20, minWidth: 28, textAlign: "center" },
  growthDelta: { color: colors.success, fontWeight: "800", fontSize: 15, minWidth: 44, textAlign: "right" },
  statRow: { flexDirection: "row", gap: space.sm },
  stat: { flex: 1, alignItems: "center", backgroundColor: colors.cardAlt, borderRadius: radius.sm, paddingVertical: 6 },
  statValue: { color: colors.text, fontSize: 15, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 11, textAlign: "center" },
  sectionHead: { color: colors.text, fontSize: 15, fontWeight: "800" },
  link: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  report: { gap: 2, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  unitRate: { fontSize: 14, fontWeight: "800" },
});
