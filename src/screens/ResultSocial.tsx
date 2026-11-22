import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Card, Field, SectionTitle } from "@/components/ui";
import {
  EMOJIS,
  EMOJI_CHAR,
  addComment,
  authErrorKey,
  deleteComment,
  getSocial,
  setHidden,
  setReaction,
  type CommentItem,
  type Emoji,
  type Social,
} from "@/lib/api";
import { colors, radius, space } from "@/theme";

/** 확인 창 (웹에는 Alert 버튼이 없어 confirm 사용) */
function confirm(title: string, message: string, ok: string, cancel: string, run: () => void) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(`${title}\n${message}`)) run();
    return;
  }
  Alert.alert(title, message, [
    { text: cancel, style: "cancel" },
    { text: ok, style: "destructive", onPress: run },
  ]);
}

/** 결과 화면 아래: 반응 6가지 + 댓글·대댓글 + (교사·관리자) 갤러리에서 내리기 */
export function ResultSocial({ sid }: { sid: string }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Social | null>(null);
  const [failed, setFailed] = useState(false);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    getSocial(sid)
      .then((d) => {
        setData(d);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [sid]);
  useEffect(load, [load]);

  if (failed) return <Text style={styles.muted}>{t("error_network")}</Text>;
  if (!data) return <ActivityIndicator color={colors.primary} />;

  const react = async (e: Emoji) => {
    const next = data.my_reaction === e ? null : e; // 같은 걸 다시 누르면 취소
    try {
      const r = await setReaction(sid, next);
      setData({ ...data, ...r });
    } catch (err) {
      setMsg(t(authErrorKey(err).key as "error_network"));
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setMsg("");
    try {
      await addComment(sid, body, replyTo?.id);
      setText("");
      setReplyTo(null);
      load();
    } catch (err) {
      setMsg(t(authErrorKey(err).key as "error_network"));
    } finally {
      setBusy(false);
    }
  };

  const remove = (c: CommentItem) =>
    confirm(t("social_delete"), t("social_deleteConfirm"), t("social_delete"), t("common_cancel"), () => {
      deleteComment(c.id)
        .then(load)
        .catch((err) => setMsg(t(authErrorKey(err).key as "error_network")));
    });

  const toggleHidden = () =>
    confirm(
      data.hidden ? t("social_unhide") : t("social_hide"),
      data.hidden ? t("social_unhideConfirm") : t("social_hideConfirm"),
      data.hidden ? t("social_unhide") : t("social_hide"),
      t("common_cancel"),
      () => {
        setHidden(sid, !data.hidden)
          .then((r) => setData({ ...data, hidden: r.hidden }))
          .catch((err) => setMsg(t(authErrorKey(err).key as "error_network")));
      },
    );

  const tops = data.comments.filter((c) => !c.parent_id);
  const repliesOf = (id: string) => data.comments.filter((c) => c.parent_id === id);
  const when = (iso: string) => new Date(iso).toLocaleString(i18n.language, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const Comment = ({ c, reply }: { c: CommentItem; reply?: boolean }) => (
    <View style={[styles.comment, reply && styles.reply]}>
      <View style={styles.commentHead}>
        <Text style={styles.name}>{c.name ?? "?"}</Text>
        {c.role && c.role !== "student" ? <Text style={styles.roleTag}>{t(`role_${c.role}`)}</Text> : null}
        <Text style={styles.time}>{when(c.created_at)}</Text>
      </View>
      <Text style={styles.body}>{c.body}</Text>
      <View style={styles.actions}>
        <Pressable onPress={() => setReplyTo(reply ? data.comments.find((x) => x.id === c.parent_id) ?? c : c)} hitSlop={8}>
          <Text style={styles.action}>{t("social_reply")}</Text>
        </Pressable>
        {c.can_delete ? (
          <Pressable onPress={() => remove(c)} hitSlop={8}>
            <Text style={[styles.action, { color: colors.danger }]}>{t("social_delete")}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={{ gap: space.md }}>
      <SectionTitle>{t("social_title")}</SectionTitle>
      {data.hidden ? (
        <Text style={styles.hiddenNote}>{t("social_hiddenNote")}</Text>
      ) : null}
      <View style={styles.emojiRow}>
        {EMOJIS.map((e) => {
          const n = data.reactions[e] ?? 0;
          const on = data.my_reaction === e;
          return (
            <Pressable key={e} onPress={() => react(e)} style={[styles.emoji, on && styles.emojiOn]}>
              <Text style={styles.emojiChar}>{EMOJI_CHAR[e]}</Text>
              <Text style={[styles.emojiCount, on && { color: colors.primary }]}>{n}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{t("social_reactHint")}</Text>

      <Card style={{ gap: space.md }}>
        <Text style={styles.count}>{t("social_comments", { count: data.comments.length })}</Text>
        {tops.length === 0 ? <Text style={styles.muted}>{t("social_noComments")}</Text> : null}
        {tops.map((c) => (
          <View key={c.id} style={{ gap: space.sm }}>
            <Comment c={c} />
            {repliesOf(c.id).map((r) => (
              <Comment key={r.id} c={r} reply />
            ))}
          </View>
        ))}
      </Card>

      {replyTo ? (
        <View style={styles.replyBar}>
          <Ionicons name="return-down-forward-outline" size={16} color={colors.primary} />
          <Text style={styles.replyText} numberOfLines={1}>
            {t("social_replyTo", { name: replyTo.name ?? "?" })}
          </Text>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
            <Text style={styles.action}>{t("common_cancel")}</Text>
          </Pressable>
        </View>
      ) : null}
      <Field
        label={replyTo ? t("social_replyLabel") : t("social_commentLabel")}
        value={text}
        onChangeText={setText}
        multiline
        maxLength={500}
        placeholder={t("social_placeholder")}
        returnKeyType="default"
      />
      <AppButton label={busy ? t("auth_working") : t("social_send")} icon="send-outline" onPress={send} disabled={busy || !text.trim()} />
      {msg ? <Text style={styles.error}>{msg}</Text> : null}

      {data.can_moderate ? (
        <AppButton
          label={data.hidden ? t("social_unhide") : t("social_hide")}
          icon={data.hidden ? "eye-outline" : "eye-off-outline"}
          variant="secondary"
          onPress={toggleHidden}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14 },
  hint: { color: colors.faint, fontSize: 11, marginTop: -6 },
  error: { color: colors.danger },
  hiddenNote: { color: colors.warning, fontSize: 13 },
  emojiRow: { flexDirection: "row", justifyContent: "space-between", gap: 6 },
  emoji: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emojiOn: { borderColor: colors.primary, backgroundColor: colors.cardAlt },
  emojiChar: { fontSize: 22 },
  emojiCount: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  count: { color: colors.text, fontWeight: "700", fontSize: 15 },
  comment: { gap: 4 },
  reply: { marginLeft: space.lg, paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: colors.border },
  commentHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { color: colors.text, fontWeight: "700", fontSize: 14 },
  roleTag: { color: colors.primary, fontSize: 11, borderWidth: 1, borderColor: colors.primary, borderRadius: 6, paddingHorizontal: 4 },
  time: { color: colors.faint, fontSize: 11 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", gap: space.lg },
  action: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: -6 },
  replyText: { color: colors.primary, fontSize: 13, flex: 1 },
});
