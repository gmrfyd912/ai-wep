import { Redirect, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, Screen } from "@/components/ui";
import { clearTutorReport, listTutorFaq, listTutorReports, type TutorFaq, type TutorReport } from "@/lib/api";
import { textbookError } from "@/screens/TextbookParts";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

type Tab = "reports" | "faq";

/** 시스템관리자: 웰디 대화 관리 — 신고된 대답 / 자주 묻는 질문 */
export default function TutorReportsScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const [tab, setTab] = useState<Tab>("reports");
  const [items, setItems] = useState<TutorReport[] | null>(null);
  const [faq, setFaq] = useState<TutorFaq[] | null>(null);
  const [days, setDays] = useState<"7" | "30" | "365">("30");
  const [error, setError] = useState("");

  useFocusEffect(
    useCallback(() => {
      setError("");
      if (tab === "reports")
        listTutorReports()
          .then((r) => setItems(r.items))
          .catch((e) => setError(textbookError(t, e)));
      else
        listTutorFaq(Number(days))
          .then((r) => setFaq(r.items))
          .catch((e) => setError(textbookError(t, e)));
    }, [t, tab, days]),
  );

  if (user?.role !== "admin") return <Redirect href="/" />;

  const done = async (id: string) => {
    try {
      await clearTutorReport(id);
      setItems((cur) => (cur ?? []).filter((x) => x.id !== id));
    } catch (e) {
      setError(textbookError(t, e));
    }
  };

  const tabs = (
    <Chips<Tab>
      options={[
        { value: "reports", label: t("tutor_tabReports") },
        { value: "faq", label: t("tutor_tabFaq") },
      ]}
      value={tab}
      onChange={setTab}
    />
  );

  if (tab === "faq")
    return (
      <Screen>
        {tabs}
        <Body muted>{t("tutor_faqIntro")}</Body>
        <Chips<"7" | "30" | "365">
          options={[
            { value: "7", label: t("tutor_faqDays", { n: 7 }) },
            { value: "30", label: t("tutor_faqDays", { n: 30 }) },
            { value: "365", label: t("tutor_faqDays", { n: 365 }) },
          ]}
          value={days}
          onChange={setDays}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!faq && !error ? <ActivityIndicator color={colors.primary} /> : null}
        {faq && faq.length === 0 ? <Body muted>{t("tutor_faqNone")}</Body> : null}
        {(faq ?? []).map((f, i) => (
          <Card key={f.id} style={{ gap: space.sm }}>
            <View style={styles.faqHead}>
              <Text style={styles.rank}>{i + 1}</Text>
              <Text style={[styles.text, { flex: 1, fontWeight: "700" }]}>{f.question}</Text>
              <Text style={styles.count}>{t("tutor_faqCount", { n: f.count })}</Text>
            </View>
            <Text style={styles.text}>{f.answer}</Text>
            <Text style={styles.small}>
              {f.lang}
              {f.printed.length ? ` · ${f.printed.map((p) => `p.${p}`).join(", ")}` : ""}
              {f.outside ? ` · ${t("tutor_outside")}` : ""}
              {f.reported ? ` · ⚑ ${t("tutor_reported")}` : ""}
            </Text>
          </Card>
        ))}
        <Text style={styles.small}>{t("tutor_faqLegend")}</Text>
      </Screen>
    );

  return (
    <Screen>
      {tabs}
      <Body muted>{t("tutor_reportsIntro")}</Body>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!items && !error ? <ActivityIndicator color={colors.primary} /> : null}
      {items && items.length === 0 ? <Body muted>{t("tutor_reportsNone")}</Body> : null}
      {(items ?? []).map((r) => (
        <Card key={r.id} style={{ gap: space.sm }}>
          <Text style={styles.small}>
            {r.name} · {r.reported_at ? r.reported_at.slice(0, 16).replace("T", " ") : ""} · {r.lang}
          </Text>
          <View style={{ gap: 2 }}>
            <Text style={styles.label}>{t("tutor_reportsQ")}</Text>
            <Text style={styles.text}>{r.question}</Text>
          </View>
          <View style={{ gap: 2 }}>
            <Text style={styles.label}>{t("tutor_reportsA")}</Text>
            <Text style={styles.text}>{r.answer}</Text>
            {r.printed.length ? <Text style={styles.small}>{r.printed.map((p) => `p.${p}`).join(", ")}</Text> : null}
          </View>
          {r.report_note ? <Text style={styles.note}>⚑ {r.report_note}</Text> : null}
          <AppButton label={t("tutor_reportsDone")} icon="checkmark-outline" variant="secondary" onPress={() => done(r.id)} />
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.danger },
  small: { color: colors.muted, fontSize: 12 },
  label: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  text: { color: colors.text, fontSize: 14, lineHeight: 20 },
  note: { color: colors.warning, fontSize: 13 },
  faqHead: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  rank: { color: colors.primary, fontSize: 18, fontWeight: "800", minWidth: 24 },
  count: { color: colors.primary, fontSize: 12, fontWeight: "700" },
});
