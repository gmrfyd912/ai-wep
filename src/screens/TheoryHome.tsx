import Ionicons from "@expo/vector-icons/Ionicons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { StudyBuddy } from "@/components/StudyBuddy";
import { AppButton, Body, Card, Screen, SectionTitle } from "@/components/ui";
import { getLastWeek, getMyDaily, getMyTextbookAfterSave, type LastWeek, type MyDaily, type MyTextbook, type TocPart } from "@/lib/api";
import { ProgressBar, textbookError } from "@/screens/TextbookParts";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

/** 이론 탭 (교육생·교사 같이 씀): AI 학습 보조 인사 + 이어서 보기 + 편·장별 진도 */
export function TheoryHome() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [data, setData] = useState<MyTextbook | null>(null);
  const [daily, setDaily] = useState<MyDaily | null | "failed">(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [greeted, setGreeted] = useState("");
  // 월요일이면 인사말로 지난주 결산 (실패하면 보통 인사말)
  const [recap, setRecap] = useState<LastWeek | null | "none">(null);

  useFocusEffect(
    useCallback(() => {
      getMyTextbookAfterSave()
        .then((d) => {
          setData(d);
          setError("");
        })
        .catch((e) => setError(textbookError(t, e)));
      getMyDaily(i18n.language)
        .then(setDaily)
        .catch(() => setDaily((d) => d ?? "failed"));
      getLastWeek()
        .then((r) => setRecap((old) => old ?? (r.monday ? r : "none")))
        .catch(() => setRecap((old) => old ?? "none"));
    }, [t, i18n.language]),
  );

  const book = data?.book ? data : null;
  const name = user?.name ?? "";
  // 인사말: 처음 받은 내용으로 한 번 정한다 (돌아올 때마다 말이 바뀌지 않게)
  let line = greeted;
  const todayQ = daily && daily !== "failed" && daily.ready ? daily : null;
  if (!line && data && daily && recap) {
    const week = recap !== "none" && book?.can_view ? recapLine(t, recap, name, user?.role) : "";
    if (week) line = week;
    else if (!data.book) line = t("buddy_helloNoBook", { name });
    else if (!book?.can_view) line = t("buddy_helloHidden", { name });
    else if (book.last_page) line = t("buddy_helloContinue", { name, page: printed(book.last_page, book.book.page_offset) });
    else line = t("buddy_helloFirst", { name });
    if (todayQ && todayQ.done < todayQ.total) line += " " + t("buddy_dailyWaiting", { n: todayQ.total - todayQ.done });
    setGreeted(line);
  }

  const openAt = (page: number) => {
    if (!book) return;
    router.push(`/book?id=${book.book.id}&page=${page}`);
  };

  return (
    <Screen>
      <Card style={{ gap: space.sm }}>
        {line ? (
          <StudyBuddy text={line} onPress={() => router.push("/tutor")} hint={t("tutor_tapToTalk")} />
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
        {book && book.can_view ? (
          <AppButton label={t("tutor_talk")} icon="chatbubble-ellipses-outline" variant="secondary" onPress={() => router.push("/tutor")} />
        ) : null}
      </Card>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {todayQ ? (
        <Card onPress={() => router.push("/daily")} style={{ gap: space.sm }}>
          <View style={styles.rowBetween}>
            <Text style={styles.bookTitle}>{t("dq_title")}</Text>
            <Text style={styles.small}>{todayQ.streak > 0 ? t("dq_streak", { n: todayQ.streak }) : ""}</Text>
          </View>
          <View style={styles.unitRow}>
            <View style={{ flex: 1 }}>
              <ProgressBar ratio={todayQ.total ? todayQ.done / todayQ.total : 0} color={todayQ.done >= todayQ.total ? colors.success : colors.primary} />
            </View>
            <Text style={styles.small}>{t("dq_dayDone", { done: todayQ.done, total: todayQ.total })}</Text>
          </View>
          <AppButton
            label={todayQ.done >= todayQ.total ? t("dq_reviewToday", { score: todayQ.score, max: todayQ.max_score }) : t("dq_start")}
            icon={todayQ.done >= todayQ.total ? "checkmark-done-outline" : "create-outline"}
            variant={todayQ.done >= todayQ.total ? "secondary" : "primary"}
            onPress={() => router.push("/daily")}
          />
        </Card>
      ) : null}

      {user && (user.role === "teacher" || user.role === "admin") ? (
        <AppButton label={t("lo_teacherTitle")} icon="flash-outline" onPress={() => router.push("/live-ox")} />
      ) : null}

      {data?.book ? (
        <AppButton label={t("sb_title")} icon="podium-outline" variant="secondary" onPress={() => router.push("/study-board")} />
      ) : null}

      {data && !data.book ? <Body muted>{t("theory_noBook")}</Body> : null}
      {book && !book.can_view ? <Body muted>{t("theory_hidden")}</Body> : null}

      {book && book.can_view ? (
        <>
          <Card style={{ gap: space.sm }}>
            <Text style={styles.bookTitle}>{book.book.title}</Text>
            <View style={styles.rowBetween}>
              <Text style={styles.small}>{t("theory_overall")}</Text>
              <Text style={styles.small}>
                {t("theory_pagesDone", { done: book.done_count, pages: book.book.pages })} ·{" "}
                {pct(book.done_count, book.book.pages)}%
              </Text>
            </View>
            <ProgressBar ratio={book.book.pages ? book.done_count / book.book.pages : 0} />
            {book.last_page ? (
              <AppButton
                label={t("theory_continue", { page: printed(book.last_page, book.book.page_offset) })}
                icon="book-outline"
                onPress={() => openAt(book.last_page!)}
              />
            ) : null}
            <AppButton
              label={t("theory_start")}
              icon="play-skip-back-outline"
              variant={book.last_page ? "secondary" : "primary"}
              onPress={() => openAt(firstPage(book.toc))}
            />
          </Card>

          <SectionTitle>{t("theory_units")}</SectionTitle>
          <Legend />
          {book.toc.length === 0 ? <Body muted>{t("theory_noToc")}</Body> : null}
          {book.toc.map((part, pi) => (
            <Card key={pi} style={{ gap: space.sm }}>
              <Pressable style={styles.rowBetween} onPress={() => setOpen(open === pi ? null : pi)}>
                <Text style={styles.partTitle} numberOfLines={2}>
                  {part.title}
                </Text>
                <Ionicons name={open === pi ? "chevron-up" : "chevron-down"} size={18} color={colors.faint} />
              </Pressable>
              <UnitBar done={part.done ?? 0} total={part.total ?? 0} />
              {open === pi || part.chapters.length === 0 ? (
                <View style={{ gap: space.sm }}>
                  {part.chapters.length === 0 && part.pdf_page ? (
                    <AppButton label={t("theory_open")} variant="secondary" onPress={() => openAt(part.pdf_page!)} />
                  ) : null}
                  {part.chapters.map((ch, ci) => (
                    <Pressable key={ci} style={styles.chapter} onPress={() => ch.pdf_page && openAt(ch.pdf_page)} disabled={!ch.pdf_page}>
                      <View style={styles.rowBetween}>
                        <Text style={styles.chTitle} numberOfLines={2}>
                          {ch.title}
                        </Text>
                        {ch.page !== null ? <Text style={styles.small}>p.{ch.page}</Text> : null}
                      </View>
                      <UnitBar done={ch.done ?? 0} total={ch.total ?? 0} />
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

function UnitBar({ done, total }: { done: number; total: number }) {
  const full = total > 0 && done >= total;
  return (
    <View style={styles.unitRow}>
      <View style={{ flex: 1 }}>
        <ProgressBar ratio={total ? done / total : 0} color={full ? colors.success : colors.primary} />
      </View>
      <Text style={[styles.small, full && { color: colors.success }]}>{full ? "✓" : `${pct(done, total)}%`}</Text>
    </View>
  );
}

function Legend() {
  const { t } = useTranslation();
  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.swatch, { backgroundColor: colors.primary }]} />
        <Text style={styles.small}>{t("theory_legendDoing")}</Text>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.swatch, { backgroundColor: colors.success }]} />
        <Text style={styles.small}>{t("theory_legendDone")}</Text>
      </View>
      <Text style={styles.small}>{t("theory_legendRule")}</Text>
    </View>
  );
}

/** 월요일 인사말: 지난주 결산 (교육생은 내 기록, 교사·관리자는 맡은 반) */
function recapLine(t: TFunction, r: LastWeek, name: string, role?: string): string {
  const parts: string[] = [];
  if (r.me) {
    const m = r.me;
    if (!m.solved) return t("recap_none", { name });
    parts.push(t("recap_student", { name, solved: m.solved, rate: m.rate }));
    if (m.prev_rate != null && m.prev_solved > 0 && m.prev_rate !== m.rate) {
      parts.push(m.rate > m.prev_rate ? t("recap_up", { n: m.rate - m.prev_rate }) : t("recap_down", { n: m.prev_rate - m.rate }));
    }
    if (m.live) parts.push(t("recap_live", { n: m.live }));
    if (m.rank) parts.push(t("recap_rank", { rank: m.rank, total: m.ranked }));
    if (m.weak_unit) parts.push(t("recap_weak", { unit: m.weak_unit.split("›").pop()!.trim() }));
    parts.push(t("recap_cheer"));
    return parts.join(" ");
  }
  if (role === "teacher" || role === "admin" || role === "staff") {
    if (!r.courses.length && !r.top) return "";
    parts.push(t("recap_teacherHello", { name }));
    r.courses.forEach((c) => parts.push(t("recap_course", { course: c.name, p: c.participation, rate: c.avg_rate })));
    if (r.top) parts.push(t("recap_top", { top: r.top.name, n: r.top.solved }));
    return parts.join(" ");
  }
  return "";
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
/** 책에 인쇄된 쪽 번호 (PDF 쪽 − 차이) */
export const printed = (pdfPage: number, offset: number) => pdfPage - offset;
/** 목차에서 가장 앞 쪽 (목차가 없으면 1쪽) */
const firstPage = (toc: TocPart[]) => {
  const all = toc.flatMap((p) => [p.pdf_page, ...p.chapters.map((c) => c.pdf_page)]).filter((n): n is number => !!n && n > 0);
  return all.length ? Math.min(...all) : 1;
};

const styles = StyleSheet.create({
  error: { color: colors.danger },
  bookTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  partTitle: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 },
  chTitle: { color: colors.text, fontSize: 14, flex: 1 },
  chapter: { gap: 6, paddingVertical: 6, paddingLeft: space.sm, borderLeftWidth: 2, borderLeftColor: colors.border },
  small: { color: colors.muted, fontSize: 12 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm },
  unitRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.md },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  swatch: { width: 14, height: 6, borderRadius: 3 },
});
