import { Redirect, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { Body, Chips, Screen, SectionTitle } from "@/components/ui";
import { listTextbooks, type AdminTextbook } from "@/lib/api";
import { DailySettingsCard, QuizBankSection } from "@/screens/QuizBank";
import { textbookError } from "@/screens/TextbookParts";
import { useSession } from "@/state/session";
import { colors } from "@/theme";

/** 시스템관리자: 문제 은행 — 교재를 골라 AI 문제 만들기(범위·종류), 문제 보기·고치기, 매일 문제 개수 */
export default function QuizScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const params = useLocalSearchParams<{ book?: string }>();
  const [books, setBooks] = useState<AdminTextbook[] | null>(null);
  const [bookId, setBookId] = useState<string>(params.book ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    listTextbooks()
      .then((r) => {
        const ok = r.items.filter((b) => b.status === "ready" || b.processed > 0);
        setBooks(ok);
        setBookId((cur) => (cur && ok.some((b) => b.id === cur) ? cur : (ok.find((b) => b.is_current) ?? ok[0])?.id ?? ""));
      })
      .catch((e) => setError(textbookError(t, e)));
  }, [t]);

  if (user?.role !== "admin") return <Redirect href="/" />;
  const book = books?.find((b) => b.id === bookId);

  return (
    <Screen>
      <SectionTitle>{t("qb_pickBook")}</SectionTitle>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!books && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {books && books.length === 0 ? <Body muted>{t("qb_noBooks")}</Body> : null}
      {books && books.length > 0 ? (
        <Chips<string>
          options={books.map((b) => ({ value: b.id, label: b.is_current ? `★ ${b.title}` : b.title }))}
          value={bookId}
          onChange={setBookId}
        />
      ) : null}
      {books && books.some((b) => b.is_current) ? <Text style={styles.small}>{t("qb_currentMark")}</Text> : null}
      {book ? <QuizBankSection key={book.id} bookId={book.id} ready={book.status === "ready"} /> : null}
      <DailySettingsCard />
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
  small: { color: colors.muted, fontSize: 12 },
});
