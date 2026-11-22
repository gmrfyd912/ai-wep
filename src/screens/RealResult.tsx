import { Image } from "expo-image";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, Screen, SectionTitle } from "@/components/ui";
import { ZoomImage } from "@/components/ZoomImage";
import { getSubmission, listStudentSubmissions, listSubmissions, statusKey, type Submission, type SubmissionListItem } from "@/lib/api";
import { defectName } from "@/lib/defects";
import { AiReport } from "@/screens/AiReport";
import { Cumulative, RecordLegend, RecordRow, groupOf } from "@/screens/Cumulative";
import { ResultCharts } from "@/screens/ResultCharts";
import { colors, radius, space } from "@/theme";

type Tab = "metrics" | "report";

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

export function RealResult({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("metrics");
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

  const res = data.result;
  const bead = res?.bead;
  const date = new Date(data.created_at).toLocaleString(i18n.language);
  const info = [data.process, data.position, data.material].filter(Boolean).join(" · ");
  const at = (v: number | undefined) => (v == null ? undefined : t("result_atPos", { mm: v.toFixed(0) }));

  return (
    <Screen>
      <View>
        {data.owner_name ? <Text style={styles.owner}>{t("result_ownerOf", { name: data.owner_name })}</Text> : null}
        <Text style={styles.title}>{info || t("result_title")}</Text>
        <Text style={styles.meta}>{date}</Text>
      </View>

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
          <AiReport sid={data.id} score={data.score} />
        </View>
      ) : null}
      {tab === "report" ? null : data.status !== "ok" ? (
        <>
          <Card>
            <Text style={styles.error}>{t(statusKey(data.status))}</Text>
          </Card>
          {data.photo_url ? <Image source={{ uri: data.photo_url }} style={styles.image} contentFit="contain" /> : null}
          <AppButton label={t("result_tryAgain")} icon="camera-outline" onPress={() => router.replace("/student/upload")} />
        </>
      ) : (
        <>
          {res ? <ResultCharts result={res} checkUrl={data.check_url} /> : null}
          {data.check_url && !res?.check_layout ? (
            <Text style={styles.caption}>{t("result_checkImage")}</Text>
          ) : null}
          {data.check_url && !res?.check_layout ? (
            <>
              <Pressable onPress={() => setZoom(true)}>
                <Image source={{ uri: data.check_url }} style={styles.image} contentFit="contain" />
              </Pressable>
              <Text style={styles.note}>{t("result_tapToZoom")}</Text>
              <ZoomImage uri={data.check_url} visible={zoom} onClose={() => setZoom(false)} />
            </>
          ) : null}
          <Metric label={t("result_widthMean")} value={mm(bead?.width.mean_mm)} big />
          <Metric label={t("result_widthMin")} value={mm(bead?.width.min_mm)} sub={at(bead?.width.min_pos_mm)} colors={[C.min]} />
          <Metric label={t("result_widthMax")} value={mm(bead?.width.max_mm)} sub={at(bead?.width.max_pos_mm)} colors={[C.max]} />
          <Metric label={t("result_widthStd")} value={mm(bead?.width.std_mm)} />
          <Metric
            label={t("result_straightMax")}
            value={mm(bead?.straightness.max_dev_mm)}
            sub={at(bead?.straightness.max_dev_pos_mm)}
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
                [C.baseline, "legend_baseline"],
                [C.maxDev, "legend_maxDev"],
                [C.min, "legend_minPos"],
                [C.max, "legend_maxPos"],
                [C.defect, "legend_defect"],
                [C.excluded, "legend_excluded"],
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
  const group = groupOf(data);
  const same = history
    .filter((r) => groupOf(r) === group)
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
  owner: { color: colors.primary, fontWeight: "700", fontSize: 14 },
  title: { color: colors.text, fontSize: 20, fontWeight: "800" },
  meta: { color: colors.muted, fontSize: 13 },
  caption: { color: colors.muted, fontSize: 13 },
  image: { width: "100%", height: 260, borderRadius: radius.md, backgroundColor: colors.card },
  error: { color: colors.danger, fontSize: 15, lineHeight: 22 },
  warnTitle: { color: colors.warning, fontWeight: "700" },
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
