import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Body, Card, Chips, ComingSoon, ImagePlaceholder, PreviewNotice, Screen, ScoreBadge } from "@/components/ui";
import { UUID_RE } from "@/lib/api";
import { courseById, resultById, studentById } from "@/mock/data";
import { RealResult } from "@/screens/RealResult";
import { colors, space } from "@/theme";

type Tab = "metrics" | "report";

export default function ResultScreen() {
  const { t } = useTranslation();
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const [tab, setTab] = useState<Tab>("metrics");
  // 실제 분석 기록(서버 번호)이면 실제 결과 화면, 아니면 1단계 가짜 데이터(갤러리·랭킹용)
  if (id && UUID_RE.test(id)) return <RealResult id={id} focus={focus} />;
  const r = resultById(id);
  const s = r ? studentById(r.studentId) : undefined;
  if (!r || !s) return <Screen><Body muted>—</Body></Screen>;

  return (
    <Screen>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{s.name}</Text>
          <Text style={styles.course}>{courseById(s.courseId)?.name}</Text>
        </View>
        <ScoreBadge score={r.score} />
      </View>

      <Chips<Tab>
        options={[
          { value: "metrics", label: t("result_tabMetrics") },
          { value: "report", label: t("result_tabReport") },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "metrics" ? (
        <>
          <ImagePlaceholder label={t("result_imagePlaceholder")} height={220} />
          <Metric label={t("result_width")} value={`${r.widthDevMm} mm`} />
          <Metric label={t("result_straightness")} value={`${r.straightDevMm} mm`} />
          <Metric
            label={t("result_defects")}
            value={r.defects.length ? r.defects.map((d) => t(`defect_${d}`)).join(", ") : t("defect_none")}
          />
          <ComingSoon step={3} />
        </>
      ) : (
        <>
          <Card>
            <Body muted>{t("result_reportPlaceholder")}</Body>
          </Card>
          <ComingSoon step={5} />
        </>
      )}
      <PreviewNotice />
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center" },
  name: { color: colors.text, fontSize: 20, fontWeight: "800" },
  course: { color: colors.muted, fontSize: 13 },
  metric: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  metricLabel: { color: colors.muted, fontSize: 14, flex: 1 },
  metricValue: { color: colors.text, fontSize: 16, fontWeight: "700" },
});
