import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { ClassJudgmentCard } from "@/components/ClassJudgmentCard";
import { AppButton, Body, Card, Chips, Screen, SectionTitle } from "@/components/ui";
import { ZoomImage } from "@/components/ZoomImage";
import { getSubmission, listStudentSubmissions, listSubmissions, statusKey, type Submission, type SubmissionListItem } from "@/lib/api";
import { defectName } from "@/lib/defects";
import { AiReport } from "@/screens/AiReport";
import { Cumulative, RecordLegend, RecordRow, groupOf } from "@/screens/Cumulative";
import { ResultCharts } from "@/screens/ResultCharts";
import { ResultSocial } from "@/screens/ResultSocial";
import { useSession } from "@/state/session";
import { colors, radius, space } from "@/theme";

type Tab = "metrics" | "report";
type Side = "front" | "back";

const mm = (v: number | null | undefined) => (v == null ? "—" : `${v.toFixed(1)} mm`);

// 확인 그림의 색 (서버 engine/visualize.py 와 같은 색)
const C = {
  outline: "#3CDC3C",
  center: "#FFE600",
  baseline: "#0078FF",
  maxDev: "#FFFFFF",
  min: "#FF0000",
  max: "#FF00FF",
  defect: "#FF8C00",
  excluded: "#2A2A2A",
};

export function RealResult({ id, focus }: { id: string; focus?: string }) {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const scrolled = useRef(false);
  const [tab, setTab] = useState<Tab>("metrics");
  const [side, setSide] = useState<Side>("front");
  const [reportOpened, setReportOpened] = useState(false);
  const [data, setData] = useState<Submission | null>(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [history, setHistory] = useState<SubmissionListItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    getSubmission(id)
      .then((d) => {
        if (!alive) return;
        setData(d);
        // 누적 분석·지난 분석 목록용: 교사 등이 학생 결과를 볼 때는 그 학생의 기록
        // (실패해도 이번 결과는 보이게 조용히 넘어감)
        const owner = d.owner_name ? d.user_id : undefined;
        (owner ? listStudentSubmissions(owner) : listSubmissions())
          .then((r) => alive && setHistory(r))
          .catch(() => alive && setHistory([]));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id]);

  if (failed) {
    return (
      <Screen>
        <Text style={styles.error}>{t("error_network")}</Text>
      </Screen>
    );
  }
  if (!data) {
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }

  // 이면 탭이면 이면 결과로 같은 화면을 그린다 (점수·랭킹·누적 분석·댓글은 정면 기록 기준)
  const back = data.back;
  const view =
    side === "back" && back
      ? { status: back.status, result: back.result, photo_url: back.photo_url, check_url: back.check_url, class_judgment: back.class_judgment }
      : { status: data.status, result: data.result, photo_url: data.photo_url, check_url: data.check_url, class_judgment: data.class_judgment };
  const res = view.result;
  const bead = res?.bead;
  const date = new Date(data.created_at).toLocaleString(i18n.language);
  const pipe = data.work_type === "pipe";
  const info = [
    pipe ? t("work_pipe") : null,
    data.process,
    data.position,
    data.material,
    pipe && data.pipe_od_mm ? t("pipe_odShort", { od: data.pipe_od_mm }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const at = (v: number | undefined, arc?: number) =>
    pipe && arc != null
      ? t("pipe_atArc", { mm: arc.toFixed(0) }) // 배관: 검사 구간 왼쪽 끝(45°)에서 원둘레 거리
      : v == null
        ? undefined
        : t("result_atPos", { mm: v.toFixed(0) });

  return (
    <Screen scrollRef={scrollRef}>
      <View>
        {data.owner_name ? (
          <Pressable onPress={() => data.user_id && router.push({ pathname: "/student-view/[id]", params: { id: data.user_id } })}>
            <View style={styles.ownerRow}>
              <Avatar url={data.owner_avatar_url} cacheKey={data.owner_avatar_key} name={data.owner_name} size={26} />
              <Text style={styles.owner}>{t("result_ownerOf", { name: data.owner_name })} ›</Text>
            </View>
          </Pressable>
        ) : null}
        <Text style={styles.title}>{info || t("result_title")}</Text>
        <Text style={styles.meta}>{date}</Text>
      </View>

      {back ? (
        <View style={styles.sideRow}>
          {(["front", "back"] as const).map((v) => {
            const on = side === v;
            return (
              <Pressable
                key={v}
                onPress={() => setSide(v)}
                style={[styles.sideBtn, on && styles.sideBtnOn]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.sideText, on && styles.sideTextOn]}>{t(v === "front" ? "side_front" : "side_back")}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {back && side === "back" ? <Text style={styles.sideHint}>{t("side_backHint")}</Text> : null}

      <Chips<Tab>
        options={[
          { value: "metrics", label: t("result_tabMetrics") },
          { value: "report", label: t("result_tabReport") },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v);
          if (v === "report") setReportOpened(true);
        }}
      />

      {/* AI 리포트: 탭을 처음 열 때 만들고, 다른 탭에 갔다 와도 다시 부르지 않게 숨겨 둔다 */}
      {reportOpened ? (
        <View style={{ gap: space.md, display: tab === "report" ? "flex" : "none" }}>
          <AiReport
            sid={data.id}
            score={data.score}
            classJudgment={data.class_judgment}
            side={side}
            back={back ? { score: back.score, classJudgment: back.class_judgment } : undefined}
          />
        </View>
      ) : null}
      {tab === "report" ? null : view.status !== "ok" ? (
        <>
          <Card>
            <Text style={styles.error}>{t(statusKey(view.status))}</Text>
          </Card>
          {view.photo_url ? <Image source={{ uri: view.photo_url }} style={styles.image} contentFit="contain" /> : null}
          {!data.owner_name ? (
            <AppButton
              label={t("result_tryAgain")}
              icon="camera-outline"
              onPress={() => router.replace(user?.role === "teacher" ? "/teacher/upload" : "/student/upload")}
            />
          ) : null}
        </>
      ) : (
        <>
          {pipe && bead?.pipe ? (
            <Card>
              <Text style={styles.pipeTitle}>{t("pipe_zoneTitle")}</Text>
              <Text style={styles.pipeText}>{t("pipe_zoneText", { od: bead.pipe.od_mm, arc: bead.pipe.zone_arc_mm.toFixed(0) })}</Text>
              {data.position?.endsWith("F") ? <Text style={styles.pipeWarn}>{t("pipe_filletTemp")}</Text> : null}
            </Card>
          ) : null}
          {res?.outline_review?.status === "check" ? (
            <Card style={styles.outlineCard}>
              <Text style={styles.outlineTitle}>{t("outline_checkTitle")}</Text>
              <Body>
                {t(`outline_reason_${res.outline_review.reason ?? "other"}`, { defaultValue: t("outline_reason_other") })}
                {res.outline_review.where && res.outline_review.where !== "none"
                  ? ` (${t(`outline_where_${res.outline_review.where}`)})`
                  : ""}
              </Body>
              <Text style={styles.note}>{t("outline_checkNote")}</Text>
            </Card>
          ) : null}
          {res ? <ResultCharts result={res} checkUrl={view.check_url} /> : null}
          {view.check_url && !res?.check_layout ? (
            <Text style={styles.caption}>{t("result_checkImage")}</Text>
          ) : null}
          {view.check_url && !res?.check_layout ? (
            <>
              <Pressable onPress={() => setZoom(true)}>
                <Image source={{ uri: view.check_url }} style={styles.image} contentFit="contain" />
              </Pressable>
              <Text style={styles.note}>{t("result_tapToZoom")}</Text>
              <ZoomImage uri={view.check_url} visible={zoom} onClose={() => setZoom(false)} />
            </>
          ) : null}
          <Metric label={t("result_widthMean")} value={mm(bead?.width.mean_mm)} big />
          <Metric label={t("result_widthMin")} value={mm(bead?.width.min_mm)} sub={at(bead?.width.min_pos_mm, bead?.width.min_pos_arc_mm)} colors={[C.min]} />
          <Metric label={t("result_widthMax")} value={mm(bead?.width.max_mm)} sub={at(bead?.width.max_pos_mm, bead?.width.max_pos_arc_mm)} colors={[C.max]} />
          <Metric label={t("result_widthStd")} value={mm(bead?.width.std_mm)} />
          <Metric
            label={t("result_straightMax")}
            value={mm(bead?.straightness.max_dev_mm)}
            sub={at(bead?.straightness.max_dev_pos_mm, bead?.straightness.max_dev_pos_arc_mm)}
            colors={[C.center, C.baseline, C.maxDev]}
          />
          <Metric label={t("result_length")} value={mm(bead?.length_mm)} colors={[C.outline]} />
          <Metric
            label={t("result_defects")}
            colors={[C.defect]}
            value={
              res?.defects?.length
                ? res.defects.map((d) => defectName(d.type)).join(", ")
                : t("defect_none")
            }
          />
          {view.class_judgment ? <ClassJudgmentCard cj={view.class_judgment} /> : null}
          {res?.warnings?.length ? (
            <Card>
              <Text style={styles.warnTitle}>{t("result_warnings")}</Text>
              {res.warnings.map((w) => (
                <Body key={w}>• {i18n.exists(`warn_${w}`) ? t(`warn_${w}`) : w}</Body>
              ))}
            </Card>
          ) : null}
          <Card>
            <Text style={styles.legendTitle}>{t("legend_title")}</Text>
            {(
              [
                [C.outline, "legend_outline"],
                [C.center, "legend_center"],
                [C.baseline, pipe ? "legend_baselineCurve" : "legend_baseline"],
                [C.maxDev, "legend_maxDev"],
                [C.min, "legend_minPos"],
                [C.max, "legend_maxPos"],
                [C.defect, "legend_defect"],
                [C.excluded, pipe ? "legend_excludedPipe" : "legend_excluded"],
              ] as const
            ).map(([c, k]) => (
              <View key={k} style={styles.legendRow}>
                <Dot color={c} />
                <Text style={styles.legendText}>{t(k)}</Text>
              </View>
            ))}
          </Card>
          <Text style={styles.note}>{t("result_measureNote")}</Text>
          <Text style={styles.note}>{t("result_betaNote")}</Text>
        </>
      )}
      {data.status === "ok" ? (
        <View
          onLayout={(e) => {
            // 알림에서 왔으면 댓글 쪽으로 바로 내려 준다 (한 번만)
            if (focus === "comments" && !scrolled.current) {
              scrolled.current = true;
              const y = e.nativeEvent.layout.y;
              setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }), 300);
            }
          }}
        >
          <ResultSocial sid={data.id} />
        </View>
      ) : null}
      {tab === "metrics" ? <History data={data} history={history} /> : null}
      {/* 맨 아래가 휴대폰 버튼 줄에 붙지 않게 여백 */}
      <View style={{ height: 32 }} />
    </Screen>
  );
}

/** 결과 화면 아래: 같은 용접법·자세의 누적 분석 + 지난 분석 목록 (첫 업로드부터 지금까지) */
function History({ data, history }: { data: Submission; history: SubmissionListItem[] | null }) {
  const { t } = useTranslation();
  if (history == null) return <ActivityIndicator color={colors.primary} />;
  const group = groupOf(data, t("work_pipe"));
  const same = history
    .filter((r) => groupOf(r, t("work_pipe")) === group)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const ok = same.filter((r) => r.status === "ok");
  return (
    <>
      {data.status === "ok" && ok.some((r) => r.id === data.id) ? (
        <Cumulative rows={ok} currentId={data.id} group={group} />
      ) : null}
      {same.length ? (
        <>
          <SectionTitle>{t("cum_pastTitle", { group })}</SectionTitle>
          <RecordLegend />
          {[...same].reverse().map((r) => (
            <RecordRow key={r.id} r={r} current={r.id === data.id} showInfo={false} />
          ))}
        </>
      ) : null}
    </>
  );
}

function Dot({ color }: { color: string }) {
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function Metric({
  label,
  value,
  big,
  sub,
  colors: dots = [],
}: {
  label: string;
  value: string;
  big?: boolean;
  sub?: string;
  colors?: string[];
}) {
  return (
    <Card style={styles.metric}>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.labelRow}>
          {dots.map((c) => (
            <Dot key={c} color={c} />
          ))}
          <Text style={styles.metricLabel}>{label}</Text>
        </View>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
      <Text style={[styles.metricValue, big && { fontSize: 20 }]}>{value}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  sideRow: { flexDirection: "row", gap: space.sm },
  sideBtn: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  sideBtnOn: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  sideText: { color: colors.muted, fontSize: 16, fontWeight: "800" },
  sideTextOn: { color: colors.text },
  sideHint: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  pipeTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  pipeText: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  pipeWarn: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  owner: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  ownerRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { color: colors.text, fontSize: 20, fontWeight: "800" },
  meta: { color: colors.muted, fontSize: 13 },
  caption: { color: colors.muted, fontSize: 13 },
  image: { width: "100%", height: 260, borderRadius: radius.md, backgroundColor: colors.card },
  error: { color: colors.danger, fontSize: 15, lineHeight: 22 },
  warnTitle: { color: colors.warning, fontWeight: "700" },
  outlineCard: { borderColor: colors.warning, borderWidth: 1 },
  outlineTitle: { color: colors.warning, fontWeight: "800", fontSize: 15 },
  note: { color: colors.faint, fontSize: 12, textAlign: "center" },
  metric: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  metricLabel: { color: colors.muted, fontSize: 14, flexShrink: 1 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  sub: { color: colors.faint, fontSize: 12 },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: "#555" },
  legendTitle: { color: colors.text, fontWeight: "700" },
  legendRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  legendText: { color: colors.muted, fontSize: 13, flex: 1 },
  metricValue: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
