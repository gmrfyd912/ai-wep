import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Field, Screen, SectionTitle } from "@/components/ui";
import { listTextbooks, uploadTextbook, type AdminTextbook, type PickedFile } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

import { DailySettingsCard } from "@/screens/QuizBank";
import { BookStatus, ProgressBar, StatusLegend, textbookError } from "@/screens/TextbookParts";

/** 시스템관리자: 교재 목록 + 교재 PDF 올리기 (서버가 쪽마다 그림·글자로 나눔) */
export default function TextbooksScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const [rows, setRows] = useState<AdminTextbook[] | null>(null);
  const [file, setFile] = useState<(PickedFile & { size?: number }) | null>(null);
  const [title, setTitle] = useState("");
  const [sent, setSent] = useState<number | null>(null); // 올라간 비율 (올리는 중일 때만)
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    listTextbooks()
      .then((r) => setRows(r.items))
      .catch((e) => setError(textbookError(t, e)));
  }, [t]);
  useFocusEffect(load);

  // 나누는 중인 교재가 있으면 5초마다 새로 받아 진행을 보여 준다
  const running = rows?.some((r) => r.running) ?? false;
  useEffect(() => {
    if (!running) return;
    timer.current = setTimeout(load, 5000);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [running, rows, load]);

  if (user?.role !== "admin") return <Redirect href="/" />;

  const pick = async () => {
    setError("");
    const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (r.canceled) return;
    const a = r.assets[0];
    setFile({ uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file ?? null, size: a.size });
    if (!title.trim()) setTitle(a.name.replace(/\.pdf$/i, ""));
  };

  const upload = async () => {
    if (!file) return;
    setError("");
    setSent(0);
    try {
      const book = await uploadTextbook(file, title.trim(), null, setSent);
      setFile(null);
      setTitle("");
      router.push(`/manage/textbook/${book.id}`);
    } catch (e) {
      setError(textbookError(t, e));
    } finally {
      setSent(null);
      load();
    }
  };

  return (
    <Screen>
      <Body muted>{t("tb_adminIntro")}</Body>

      <SectionTitle>{t("tb_uploadTitle")}</SectionTitle>
      <Card style={{ gap: space.md }}>
        <AppButton label={file ? t("tb_pickOther") : t("tb_pick")} icon="document-outline" variant="secondary" onPress={pick} disabled={sent !== null} />
        {file ? (
          <Text style={styles.file}>
            {file.name}
            {file.size ? `  ·  ${(file.size / 1024 / 1024).toFixed(1)}MB` : ""}
          </Text>
        ) : null}
        <Field label={t("tb_bookTitle")} value={title} onChangeText={setTitle} placeholder={t("tb_bookTitlePh")} maxLength={120} />
        {sent !== null ? (
          <View style={{ gap: space.xs }}>
            <Text style={styles.small}>{t("tb_uploading", { pct: Math.round(sent * 100) })}</Text>
            <ProgressBar ratio={sent} />
          </View>
        ) : null}
        <AppButton label={t("tb_upload")} icon="cloud-upload-outline" onPress={upload} disabled={!file || sent !== null || running} />
        <Text style={styles.small}>{running ? t("tb_oneAtATime") : t("tb_uploadHint")}</Text>
      </Card>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <SectionTitle>{t("tb_list")}</SectionTitle>
      {!rows && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {rows && rows.length === 0 ? <Body muted>{t("tb_none")}</Body> : null}
      {rows?.map((b) => (
        <Card key={b.id} onPress={() => router.push(`/manage/textbook/${b.id}`)} style={{ gap: space.sm }}>
          <View style={styles.row}>
            {b.is_current ? <Ionicons name="star" size={18} color={colors.primary} /> : null}
            <Text style={styles.title} numberOfLines={2}>
              {b.title}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </View>
          <BookStatus book={b} />
        </Card>
      ))}
      {rows && rows.length > 0 ? <StatusLegend /> : null}

      <DailySettingsCard />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { color: colors.text, fontSize: 16, fontWeight: "700", flex: 1 },
  file: { color: colors.text, fontSize: 14 },
  small: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  error: { color: colors.danger },
});
