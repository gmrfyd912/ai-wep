import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { AppButton, Body, Card, Screen, SectionTitle } from "@/components/ui";
import { getStudentInfo, listStudentSubmissions, type Member, type StudentInfo, type SubmissionListItem } from "@/lib/api";
import { DatedRecords, RecordLegend } from "@/screens/Cumulative";
import { MemberActions } from "@/screens/MemberActions";
import { colors } from "@/theme";

/** 한 사람의 기록 (랭킹·갤러리·교사 보드에서). 누구나 볼 수 있고, 담당 교사·관리자에게는 관리 버튼도 보인다.
 * 기록은 내 기록 화면과 같이 날짜별로, 누르면 그 결과 화면 */
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

  const lastLogin = info.last_login_at ? new Date(info.last_login_at).toLocaleString(i18n.language) : null;
  const courseNames = info.courses.map((c) => c.name).join(", ");
  const okCount = rows.filter((r) => r.status === "ok").length;

  return (
    <Screen>
      <Stack.Screen options={{ title: t("person_title", { name: info.name }) }} />
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar url={info.avatar_url} cacheKey={info.avatar_key} name={info.name} size={56} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.name}>
            {info.name} {info.login_id ? <Text style={styles.meta}>{info.login_id}</Text> : null}
          </Text>
          <Text style={styles.meta}>
            {t(`role_${info.role}`)}
            {courseNames ? ` · ${courseNames}` : ""}
          </Text>
          <Text style={styles.meta}>{t("person_count", { count: okCount })}</Text>
          {info.login_id ? (
            <Text style={styles.meta}>{lastLogin ? t("manage_lastLogin", { date: lastLogin }) : t("manage_never")}</Text>
          ) : null}
        </View>
      </Card>
      {info.can_care && info.login_id ? <MemberActions member={info as Member} onChanged={load} /> : null}
      {info.can_edit ? (
        <AppButton
          label={t("manage_edit")}
          variant="secondary"
          onPress={() => router.push({ pathname: "/manage/member/[id]", params: { id: info.id } })}
        />
      ) : null}
      <SectionTitle>{t("person_records")}</SectionTitle>
      {rows.length === 0 ? <Body muted>{t("student_noRecords")}</Body> : <RecordLegend />}
      <DatedRecords rows={rows} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { color: colors.text, fontSize: 18, fontWeight: "800" },
  meta: { color: colors.muted, fontSize: 13, fontWeight: "400" },
  error: { color: colors.danger },
});
