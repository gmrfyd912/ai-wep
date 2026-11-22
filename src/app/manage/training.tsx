import { Redirect } from "expo-router";
import * as Linking from "expo-linking";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Share, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, Field, Label, Screen } from "@/components/ui";
import {
  API_URL,
  authErrorKey,
  listCourses,
  trainingExport,
  type Course,
  type ExportPart,
  type ExportRange,
  type ExportSummary,
} from "@/lib/api";
import { PROCESSES, WORK_TYPES, positionsOf, type WorkType } from "@/lib/weld";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000); // 한국 날짜
  return d.toISOString().slice(0, 10);
}

/** 시스템관리자: 학습용 사진 받기 (Roboflow 추가 학습용 ZIP) */
export default function TrainingScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [range, setRange] = useState<ExportRange>("new");
  const [from, setFrom] = useState(today().slice(0, 8) + "01");
  const [to, setTo] = useState(today());
  const [proc, setProc] = useState("");
  const [pos, setPos] = useState("");
  const [work, setWork] = useState<WorkType | "">("");
  const [course, setCourse] = useState("all");
  const [courses, setCourses] = useState<Course[]>([]);
  const [sum, setSum] = useState<ExportSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const req = useRef(0);

  useEffect(() => {
    listCourses()
      .then(setCourses)
      .catch(() => null);
  }, []);

  // 조건이 바뀌면 사진 수를 다시 센다
  useEffect(() => {
    if (range === "period" && (!DATE_RE.test(from) || !DATE_RE.test(to))) {
      setSum(null);
      return;
    }
    const n = ++req.current;
    setLoading(true);
    setError("");
    setMsg("");
    const timer = setTimeout(() => {
      trainingExport({ range, date_from: from, date_to: to, process: proc, position: pos, course, work_type: work })
        .then((s) => n === req.current && setSum(s))
        .catch((e) => n === req.current && setError(t(authErrorKey(e).key as "error_network")))
        .finally(() => n === req.current && setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [range, from, to, proc, pos, course, work, t]);

  if (user?.role !== "admin") return <Redirect href="/" />;

  const day = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);
  const urlOf = (p: ExportPart) => `${API_URL}${p.path}`;
  const open = (p: ExportPart) => {
    setMsg(t("train_opening"));
    Linking.openURL(urlOf(p)).catch(() => setError(t("error_network")));
  };
  const copy = async (p: ExportPart) => {
    const url = urlOf(p);
    try {
      if (Platform.OS === "web") {
        await navigator.clipboard.writeText(url);
        setMsg(t("train_copied"));
      } else {
        await Share.share({ message: url }); // 카카오톡·메일로 PC에 보내거나 복사
      }
    } catch {
      setMsg(url);
    }
  };

  return (
    <Screen>
      <Text style={styles.hint}>{t("train_intro")}</Text>
      <Label>{t("train_range")}</Label>
      <Chips<ExportRange>
        options={[
          { value: "new", label: t("train_new") },
          { value: "period", label: t("train_period") },
          { value: "all", label: t("common_all") },
        ]}
        value={range}
        onChange={setRange}
      />
      {range === "new" ? (
        <Text style={styles.hint}>
          {sum?.last_export_at ? t("train_lastAt", { date: new Date(sum.last_export_at).toLocaleString(i18n.language) }) : t("train_never")}
        </Text>
      ) : null}
      {range === "period" ? (
        <View style={styles.dates}>
          <View style={{ flex: 1 }}>
            <Field label={t("train_from")} value={from} onChangeText={setFrom} placeholder="2026-11-01" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t("train_to")} value={to} onChangeText={setTo} placeholder="2026-11-30" />
          </View>
        </View>
      ) : null}
      {range === "period" ? <Text style={styles.hint}>{t("train_dateHint")}</Text> : null}

      <Label>{t("work_label")}</Label>
      <Chips<WorkType | "">
        options={[{ value: "", label: t("work_all") }, ...WORK_TYPES.map((w) => ({ value: w, label: t(`work_${w}`) }))]}
        value={work}
        onChange={(w) => {
          setWork(w);
          if (pos && !positionsOf(w).includes(pos)) setPos("");
        }}
      />
      <Label>{t("upload_process")}</Label>
      <Chips options={[{ value: "", label: t("common_all") }, ...PROCESSES.map((v) => ({ value: v, label: v }))]} value={proc} onChange={setProc} />
      <Label>{t("upload_position")}</Label>
      <Chips options={[{ value: "", label: t("common_all") }, ...positionsOf(work).map((v) => ({ value: v, label: v }))]} value={pos} onChange={setPos} />
      <Label>{t("signup_course")}</Label>
      <Chips
        options={[{ value: "all", label: t("common_all") }, ...courses.map((c) => ({ value: c.id, label: c.name }))]}
        value={course}
        onChange={setCourse}
      />

      {loading ? <ActivityIndicator color={colors.primary} /> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {sum && !loading ? (
        <Card>
          <Text style={styles.big}>{t("train_count", { total: sum.total })}</Text>
          <Text style={styles.hint}>{t("train_labeled", { labeled: sum.labeled, unlabeled: sum.total - sum.labeled })}</Text>
          {sum.total === 0 ? <Body muted>{t("train_empty")}</Body> : null}
        </Card>
      ) : null}
      {sum && !loading
        ? sum.parts.map((p) => (
            <Card key={p.index}>
              <Text style={styles.partTitle}>
                {t("train_part", { index: p.index, count: sum.parts.length, first: p.first, last: p.last })}
              </Text>
              <Text style={styles.hint}>
                {day(p.date_from)} ~ {day(p.date_to)}
              </Text>
              <View style={styles.buttons}>
                <View style={{ flex: 1 }}>
                  <AppButton label={t("train_download")} icon="download-outline" onPress={() => open(p)} />
                </View>
                <View style={{ flex: 1 }}>
                  <AppButton
                    label={Platform.OS === "web" ? t("train_copy") : t("train_share")}
                    icon={Platform.OS === "web" ? "copy-outline" : "share-outline"}
                    variant="secondary"
                    onPress={() => copy(p)}
                  />
                </View>
              </View>
            </Card>
          ))
        : null}
      {msg ? <Text style={styles.ok} selectable>{msg}</Text> : null}
      {sum?.parts.length ? <Text style={styles.hint}>{t("train_linkHint")}</Text> : null}
      <Text style={styles.hint}>{t("train_whatInside")}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 14 },
  ok: { color: colors.success, fontSize: 13 },
  big: { color: colors.text, fontSize: 18, fontWeight: "800" },
  partTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  dates: { flexDirection: "row", gap: space.sm },
  buttons: { flexDirection: "row", gap: space.sm, marginTop: space.xs },
});
