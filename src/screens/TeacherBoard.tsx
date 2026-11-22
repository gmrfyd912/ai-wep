import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { AppButton, Body, Card, ScoreBadge } from "@/components/ui";
import { approveMember, getCourseBoard, type CourseBoard, type CourseTeacher, type StudentCard } from "@/lib/api";
import { colors, space } from "@/theme";

const TREND_ICON = { up: "trending-up", down: "trending-down", flat: "remove" } as const;
const TREND_COLOR = { up: colors.success, down: colors.danger, flat: colors.muted };

/** 담임·부담임 한 줄 */
export function TeacherLine({ teachers }: { teachers: CourseTeacher[] }) {
  const { t } = useTranslation();
  const homeroom = teachers.filter((x) => x.course_role === "homeroom").map((x) => x.name);
  const assistants = teachers.filter((x) => x.course_role !== "homeroom").map((x) => x.name);
  const parts = [
    `${t("course_homeroom")}: ${homeroom.join(", ") || "—"}`,
    assistants.length ? `${t("course_assistant")}: ${assistants.join(", ")}` : null,
  ].filter(Boolean);
  return <Text style={styles.meta}>{parts.join(" · ")}</Text>;
}

/** 한 과정의 교사 보드: 요약 + 교육생 카드 목록 (누르면 그 교육생 기록) */
export function TeacherBoard({ courseId }: { courseId: string }) {
  const { t } = useTranslation();
  const [board, setBoard] = useState<CourseBoard | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getCourseBoard(courseId)
      .then(setBoard)
      .catch(() => setFailed(true));
  }, [courseId]);

  // 화면에 들어올 때마다 새로 불러온다 (승인·초기화 뒤 바로 반영)
  useFocusEffect(
    useCallback(() => {
      setBoard(null);
      load();
    }, [load]),
  );

  if (failed) {
    return (
      <Card onPress={load}>
        <Text style={styles.error}>{t("error_network")}</Text>
      </Card>
    );
  }
  if (!board) return <ActivityIndicator color={colors.primary} />;

  const approve = async (id: string) => {
    try {
      await approveMember(id);
      load();
    } catch {
      setFailed(true);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      <TeacherLine teachers={board.teachers} />
      <View style={styles.summary}>
        <Stat label={t("teacher_students")} value={String(board.summary.student_count)} />
        <Stat label={t("staff_weeklySubmissions")} value={String(board.summary.weekly_submissions)} />
        <Stat label={t("teacher_avgScore")} value={board.summary.avg_score == null ? "—" : String(board.summary.avg_score)} />
      </View>
      {board.students.length === 0 ? <Body muted>{t("board_noStudents")}</Body> : null}
      {board.students.map((s) => (
        <StudentRow key={s.id} s={s} canApprove={board.can_care} onApprove={() => approve(s.id)} />
      ))}
    </View>
  );
}

function StudentRow({ s, canApprove, onApprove }: { s: StudentCard; canApprove: boolean; onApprove: () => void }) {
  const { t } = useTranslation();
  if (s.status === "pending") {
    return (
      <Card style={{ borderColor: colors.warning }}>
        <View style={styles.cardTop}>
          <Avatar url={s.avatar_url} cacheKey={s.avatar_key} name={s.name} size={30} />
          <Text style={styles.name}>{s.name}</Text>
          <Text style={styles.meta}>{s.login_id}</Text>
          <View style={{ flex: 1 }} />
          <Text style={[styles.meta, { color: colors.warning }]}>{t("admin_memberPending")}</Text>
        </View>
        {canApprove ? <AppButton label={t("admin_memberApprove")} onPress={onApprove} /> : null}
      </Card>
    );
  }
  return (
    <Card onPress={() => router.push({ pathname: "/student-view/[id]", params: { id: s.id } })}>
      <View style={styles.cardTop}>
        <Avatar url={s.avatar_url} cacheKey={s.avatar_key} name={s.name} size={30} />
        <Text style={styles.name}>{s.name}</Text>
        <Ionicons name={TREND_ICON[s.trend]} size={20} color={TREND_COLOR[s.trend]} />
        {s.status === "disabled" ? <Text style={styles.meta}>{t("manage_statusDisabled")}</Text> : null}
        <View style={{ flex: 1 }} />
        {s.last_score != null ? <ScoreBadge score={s.last_score} /> : <Text style={styles.meta}>—</Text>}
      </View>
      <Text style={styles.meta}>
        {t("board_weekCount", { count: s.week_count })} · {t("board_total", { count: s.total })}
        {s.avg_score != null ? ` · ${t("board_avg", { score: s.avg_score })}` : ""}
      </Text>
      <Text style={styles.meta}>
        {t("teacher_frequentDefect")}: {t(`defect_${s.frequent_defect ?? "none"}`, { defaultValue: s.frequent_defect ?? "" })}
      </Text>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", gap: space.sm },
  stat: { flex: 1, alignItems: "center", padding: space.md },
  statValue: { color: colors.primary, fontSize: 22, fontWeight: "800" },
  statLabel: { color: colors.muted, fontSize: 12, textAlign: "center" },
  cardTop: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { color: colors.text, fontWeight: "700", fontSize: 16 },
  meta: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger },
});
