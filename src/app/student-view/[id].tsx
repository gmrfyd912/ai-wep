import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Screen, SectionTitle } from "@/components/ui";
import { getStudentInfo, listStudentSubmissions, type StudentInfo, type SubmissionListItem } from "@/lib/api";
import { RecordLegend, RecordRow } from "@/screens/Cumulative";
import { MemberActions } from "@/screens/MemberActions";
import { colors } from "@/theme";

/** 교사·행정 관리자·시스템관리자가 보는 교육생 한 명의 기록 (누르면 결과 화면) */
export default function StudentView() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [info, setInfo] = useState<StudentInfo | null>(null);
  const [rows, setRows] = useState<SubmissionListItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    getStudentInfo(id)
      .then(setInfo)
      .catch(() => setFailed(true));
    listStudentSubmissions(id)
      .then(setRows)
      .catch(() => setFailed(true));
  }, [id]);
  useFocusEffect(load);

  if (failed) {
    return (
      <Screen>
        <Text style={styles.error}>{t("error_network")}</Text>
      </Screen>
    );
  }
  if (!info || !rows) {
    return (
      <Screen>
        <ActivityIndicator color={colors.primary} />
      </Screen>
    );
  }

  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const lastLogin = info.last_login_at ? new Date(info.last_login_at).toLocaleString(i18n.language) : null;

  return (
    <Screen>
      <Stack.Screen options={{ title: info.name }} />
      <Card>
        <Text style={styles.name}>
          {info.name} <Text style={styles.meta}>{info.login_id}</Text>
        </Text>
        <Text style={styles.meta}>{info.courses.map((c) => c.name).join(", ")}</Text>
        <Text style={styles.meta}>{lastLogin ? t("manage_lastLogin", { date: lastLogin }) : t("manage_never")}</Text>
      </Card>
      {info.can_care ? <MemberActions member={info} onChanged={load} /> : null}
      {info.can_edit ? (
        <AppButton
          label={t("manage_edit")}
          variant="secondary"
          onPress={() => router.push({ pathname: "/manage/member/[id]", params: { id: info.id } })}
        />
      ) : null}
      <SectionTitle>{t("student_records")}</SectionTitle>
      {sorted.length === 0 ? <Body muted>{t("student_noRecords")}</Body> : <RecordLegend />}
      {sorted.map((r) => (
        <RecordRow key={r.id} r={r} />
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: 18, fontWeight: "800" },
  meta: { color: colors.muted, fontSize: 13, fontWeight: "400" },
  error: { color: colors.danger },
});
