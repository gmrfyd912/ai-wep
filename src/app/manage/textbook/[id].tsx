import Ionicons from "@expo/vector-icons/Ionicons";
import * as DocumentPicker from "expo-document-picker";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Field, Screen, SectionTitle } from "@/components/ui";
import {
  aiTextbookToc,
  deleteTextbook,
  getTextbook,
  saveTextbook,
  uploadTextbook,
  type AdminTextbook,
  type SaveTextbook,
  type TocPart,
} from "@/lib/api";
import { confirm } from "@/screens/Comments";
import { QuizBankSection } from "@/screens/QuizBank";
import { BookStatus, bookKind, ProgressBar, StatusLegend, textbookError } from "@/screens/TextbookParts";
import { useSession } from "@/state/session";
import { colors, radius, space } from "@/theme";

const num = (s: string) => {
  const d = s.replace(/[^0-9-]/g, "");
  return d === "" || d === "-" ? null : Number(d);
};

/** 시스템관리자: 교재 하나 (상태·이어서 나누기·사용 설정·쪽 번호 차이·목차·삭제) */
export default function TextbookScreen() {
  const { t } = useTranslation();
  const { user } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [book, setBook] = useState<AdminTextbook | null>(null);
  const [title, setTitle] = useState("");
  const [offset, setOffset] = useState("0");
  const [tocPages, setTocPages] = useState("");
  const [toc, setToc] = useState<TocPart[]>([]);
  const [tocDirty, setTocDirty] = useState(false);
  const [busy, setBusy] = useState<"" | "save" | "ai" | "toc" | "resume">("");
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const apply = useCallback((b: AdminTextbook, all: boolean) => {
    setBook(b);
    if (all) {
      setTitle(b.title);
      setOffset(String(b.page_offset));
      setTocPages(b.toc_pages);
      setToc(b.toc);
      setTocDirty(false);
    }
  }, []);

  const load = useCallback(
    (all: boolean) => {
      getTextbook(id)
        .then((b) => apply(b, all))
        .catch((e) => setError(textbookError(t, e)));
    },
    [id, t, apply],
  );
  useEffect(() => load(true), [load]);

  // 나누는 중이면 5초마다 진행 새로 받기 (끝나면 목차·쪽 번호 차이도 새로 채움)
  const kind = book ? bookKind(book) : null;
  useEffect(() => {
    if (kind !== "running" && kind !== "upgrading") return;
    const h = setTimeout(() => {
      getTextbook(id)
        .then((b) => apply(b, b.status !== "processing" && !b.running && !tocDirty))
        .catch(() => undefined);
    }, 5000);
    return () => clearTimeout(h);
  }, [kind, book, id, apply, tocDirty]);

  if (user?.role !== "admin") return <Redirect href="/" />;
  if (!book) {
    return <Screen>{error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}</Screen>;
  }

  const save = async (v: SaveTextbook, what: typeof busy = "save") => {
    setBusy(what);
    setError("");
    setNotice("");
    try {
      const b = await saveTextbook(book.id, v);
      apply(b, false);
      if (v.toc) {
        setToc(b.toc);
        setTocDirty(false);
      }
      setNotice(t("tb_saved"));
    } catch (e) {
      setError(textbookError(t, e));
    } finally {
      setBusy("");
    }
  };

  const resume = async () => {
    setError("");
    const r = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (r.canceled) return;
    const a = r.assets[0];
    setBusy("resume");
    setSent(0);
    try {
      apply(await uploadTextbook({ uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file ?? null }, "", book.id, setSent), false);
    } catch (e) {
      setError(textbookError(t, e));
    } finally {
      setSent(null);
      setBusy("");
    }
  };

  const runAi = async () => {
    setBusy("ai");
    setError("");
    setNotice("");
    try {
      const b = await aiTextbookToc(book.id, tocPages.trim());
      apply(b, false);
      setToc(b.toc);
      setTocDirty(false);
      setNotice(t("tb_aiDone"));
    } catch (e) {
      setError(textbookError(t, e));
    } finally {
      setBusy("");
    }
  };

  const editToc = (next: TocPart[]) => {
    setToc(next);
    setTocDirty(true);
  };

  const remove = () =>
    confirm(t("tb_deleteTitle"), t("tb_deleteConfirm"), t("tb_delete"), t("common_cancel"), async () => {
      try {
        await deleteTextbook(book.id);
        router.back();
      } catch (e) {
        setError(textbookError(t, e));
      }
    });

  const ready = book.status === "ready";

  return (
    <Screen>
      <Card style={{ gap: space.sm }}>
        <Text style={styles.bookTitle}>{book.title}</Text>
        <BookStatus book={book} />
        {kind === "stopped" || kind === "failed" ? (
          <>
            <Text style={styles.small}>{t(kind === "failed" ? "tb_failedHint" : "tb_stoppedHint")}</Text>
            {kind === "failed" && book.error ? <Text style={styles.small}>({book.error})</Text> : null}
            {sent !== null ? <ProgressBar ratio={sent} /> : null}
            <AppButton label={t("tb_resume")} icon="refresh-outline" onPress={resume} disabled={busy !== ""} />
          </>
        ) : null}
        {kind === "running" || kind === "upgrading" ? <Text style={styles.small}>{t("tb_runningHint")}</Text> : null}
        {kind === "ready" && book.low_quality ? (
          <>
            <Text style={styles.small}>{t("tb_upgradeHint")}</Text>
            {sent !== null ? <ProgressBar ratio={sent} /> : null}
            <AppButton label={t("tb_upgrade")} icon="sparkles-outline" variant="secondary" onPress={resume} disabled={busy !== ""} />
          </>
        ) : null}
        <StatusLegend />
      </Card>

      {ready ? (
        <AppButton label={t("tb_preview")} icon="book-outline" variant="secondary" onPress={() => router.push(`/book?id=${book.id}&preview=1`)} />
      ) : null}

      <SectionTitle>{t("tb_use")}</SectionTitle>
      <Card>
        <SwitchRow
          label={t("tb_isCurrent")}
          hint={ready ? t("tb_isCurrentHint") : t("tb_notReadyHint")}
          value={book.is_current}
          disabled={!ready || busy !== ""}
          onChange={(v) => save({ is_current: v })}
        />
        <SwitchRow
          label={t("tb_showStudents")}
          hint={t("tb_showStudentsHint")}
          value={book.show_students}
          disabled={busy !== ""}
          onChange={(v) => save({ show_students: v })}
        />
        <SwitchRow
          label={t("tb_useForAi")}
          hint={t("tb_useForAiHint")}
          value={book.use_for_ai}
          disabled={busy !== ""}
          onChange={(v) => save({ use_for_ai: v })}
        />
      </Card>

      <SectionTitle>{t("tb_basic")}</SectionTitle>
      <Card style={{ gap: space.md }}>
        <Field label={t("tb_bookTitle")} value={title} onChangeText={setTitle} maxLength={120} />
        <Field label={t("tb_offset")} value={offset} onChangeText={setOffset} keyboardType="numbers-and-punctuation" />
        <Text style={styles.small}>{t("tb_offsetHint")}</Text>
        <AppButton
          label={t("common_save")}
          icon="save-outline"
          onPress={() => save({ title: title.trim(), page_offset: num(offset) ?? 0 })}
          disabled={busy !== "" || !title.trim()}
        />
      </Card>

      <SectionTitle>{t("tb_toc")}</SectionTitle>
      <Card style={{ gap: space.md }}>
        <Field label={t("tb_tocPages")} value={tocPages} onChangeText={setTocPages} placeholder="5-8" />
        <Text style={styles.small}>{t("tb_tocPagesHint")}</Text>
        <AppButton
          label={busy === "ai" ? t("tb_aiRunning") : t("tb_aiToc")}
          icon="sparkles-outline"
          variant="secondary"
          onPress={runAi}
          disabled={busy !== "" || !tocPages.trim() || book.processed < 1}
        />
        {busy === "ai" ? <ActivityIndicator color={colors.primary} /> : null}
      </Card>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TocEditor toc={toc} onChange={editToc} />
      <AppButton label={t("tb_saveToc")} icon="save-outline" onPress={() => save({ toc }, "toc")} disabled={busy !== "" || !tocDirty} />

      <QuizBankSection bookId={book.id} ready={ready} />

      <View style={styles.danger}>
        <SectionTitle>{t("tb_dangerZone")}</SectionTitle>
        <AppButton label={t("tb_delete")} icon="trash-outline" variant="danger" onPress={remove} disabled={busy !== "" || kind === "running" || kind === "upgrading"} />
        <Text style={styles.small}>{t("tb_deleteHint")}</Text>
      </View>
    </Screen>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.small}>{hint}</Text>
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onChange} trackColor={{ true: colors.primary, false: colors.border }} />
    </View>
  );
}

/** 목차 고치기: 편 → 장 → 절. 쪽 = 책에 인쇄된 쪽 번호 */
function TocEditor({ toc, onChange }: { toc: TocPart[]; onChange: (v: TocPart[]) => void }) {
  const { t } = useTranslation();
  const setPart = (pi: number, p: TocPart) => onChange(toc.map((x, i) => (i === pi ? p : x)));
  const empty = { title: "", page: null };

  return (
    <View style={{ gap: space.sm }}>
      <View style={styles.legend}>
        <Text style={styles.small}>{t("tb_tocLegend")}</Text>
      </View>
      {toc.length === 0 ? <Body muted>{t("tb_tocEmpty")}</Body> : null}
      {toc.map((part, pi) => (
        <Card key={pi} style={{ gap: space.xs }}>
          <TocLine
            level={0}
            title={part.title}
            page={part.page}
            onTitle={(v) => setPart(pi, { ...part, title: v })}
            onPage={(v) => setPart(pi, { ...part, page: v })}
            onRemove={() => onChange(toc.filter((_, i) => i !== pi))}
          />
          {part.chapters.map((ch, ci) => {
            const setCh = (c: typeof ch) => setPart(pi, { ...part, chapters: part.chapters.map((x, i) => (i === ci ? c : x)) });
            return (
              <View key={ci} style={{ gap: space.xs }}>
                <TocLine
                  level={1}
                  title={ch.title}
                  page={ch.page}
                  onTitle={(v) => setCh({ ...ch, title: v })}
                  onPage={(v) => setCh({ ...ch, page: v })}
                  onRemove={() => setPart(pi, { ...part, chapters: part.chapters.filter((_, i) => i !== ci) })}
                />
                {ch.sections.map((s, si) => (
                  <TocLine
                    key={si}
                    level={2}
                    title={s.title}
                    page={s.page}
                    onTitle={(v) => setCh({ ...ch, sections: ch.sections.map((x, i) => (i === si ? { ...x, title: v } : x)) })}
                    onPage={(v) => setCh({ ...ch, sections: ch.sections.map((x, i) => (i === si ? { ...x, page: v } : x)) })}
                    onRemove={() => setCh({ ...ch, sections: ch.sections.filter((_, i) => i !== si) })}
                  />
                ))}
                <AddLink level={2} label={t("tb_addSection")} onPress={() => setCh({ ...ch, sections: [...ch.sections, { ...empty }] })} />
              </View>
            );
          })}
          <AddLink level={1} label={t("tb_addChapter")} onPress={() => setPart(pi, { ...part, chapters: [...part.chapters, { ...empty, sections: [] }] })} />
        </Card>
      ))}
      <AddLink level={0} label={t("tb_addPart")} onPress={() => onChange([...toc, { ...empty, chapters: [] }])} />
    </View>
  );
}

const LEVEL_TAG = ["tb_lvPart", "tb_lvChapter", "tb_lvSection"] as const;

function TocLine({
  level,
  title,
  page,
  onTitle,
  onPage,
  onRemove,
}: {
  level: 0 | 1 | 2;
  title: string;
  page: number | null;
  onTitle: (v: string) => void;
  onPage: (v: number | null) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.line, { marginLeft: level * 14 }]}>
      <Text style={[styles.tag, level === 0 && { color: colors.primary }]}>{t(LEVEL_TAG[level])}</Text>
      <TextInput
        value={title}
        onChangeText={onTitle}
        placeholder={t("tb_tocTitlePh")}
        placeholderTextColor={colors.faint}
        style={[styles.input, { flex: 1 }, level === 0 && { fontWeight: "700" }]}
        maxLength={200}
      />
      <TextInput
        value={page === null ? "" : String(page)}
        onChangeText={(v) => onPage(num(v))}
        placeholder={t("tb_pageShort")}
        placeholderTextColor={colors.faint}
        keyboardType="number-pad"
        style={[styles.input, styles.page]}
        maxLength={4}
      />
      <Pressable onPress={onRemove} hitSlop={8}>
        <Ionicons name="close-circle-outline" size={20} color={colors.faint} />
      </Pressable>
    </View>
  );
}

function AddLink({ level, label, onPress }: { level: number; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.add, { marginLeft: level * 14 }]} hitSlop={6}>
      <Ionicons name="add" size={16} color={colors.primary} />
      <Text style={styles.addText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bookTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  small: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  label: { color: colors.text, fontSize: 15 },
  error: { color: colors.danger },
  notice: { color: colors.success },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8 },
  legend: { paddingHorizontal: space.xs },
  line: { flexDirection: "row", alignItems: "center", gap: 6 },
  tag: { color: colors.muted, fontSize: 11, width: 22 },
  input: {
    color: colors.text,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 14,
  },
  page: { width: 56, textAlign: "center" },
  add: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  addText: { color: colors.primary, fontSize: 13 },
  danger: { marginTop: space.xl, gap: space.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: space.md },
});
