import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { addComment, authErrorKey, deleteComment, getSocial, type CommentItem } from "@/lib/api";
import { colors, radius, space } from "@/theme";

/** 확인 창 (웹에는 Alert 버튼이 없어 confirm 사용) */
export function confirm(title: string, message: string, ok: string, cancel: string, run: () => void) {
  if (Platform.OS === "web") {
    if (globalThis.confirm?.(`${title}\n${message}`)) run();
    return;
  }
  Alert.alert(title, message, [
    { text: cancel, style: "cancel" },
    { text: ok, style: "destructive", onPress: run },
  ]);
}

/** 댓글·답글 목록 (답글은 한 단계까지, 들여쓰기) */
export function CommentList({
  comments,
  onReply,
  onDeleted,
  onError,
}: {
  comments: CommentItem[];
  onReply: (target: CommentItem) => void;
  onDeleted: () => void;
  onError: (msg: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const tops = comments.filter((c) => !c.parent_id);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

  const remove = (c: CommentItem) =>
    confirm(t("social_delete"), t("social_deleteConfirm"), t("social_delete"), t("common_cancel"), () => {
      deleteComment(c.id)
        .then(onDeleted)
        .catch((err) => onError(t(authErrorKey(err).key as "error_network")));
    });

  const one = (c: CommentItem, reply?: boolean) => (
    <View key={c.id} style={[styles.comment, reply && styles.reply]}>
      <Avatar url={c.avatar_url} cacheKey={c.avatar_key} name={c.name} size={reply ? 26 : 30} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.commentHead}>
          <Text style={styles.name}>{c.name ?? "?"}</Text>
          {c.role && c.role !== "student" ? <Text style={styles.roleTag}>{t(`role_${c.role}`)}</Text> : null}
          <Text style={styles.time}>{when(c.created_at)}</Text>
        </View>
        <Text style={styles.body}>{c.body}</Text>
        <View style={styles.actions}>
          <Pressable onPress={() => onReply(reply ? comments.find((x) => x.id === c.parent_id) ?? c : c)} hitSlop={8}>
            <Text style={styles.action}>{t("social_reply")}</Text>
          </Pressable>
          {c.can_delete ? (
            <Pressable onPress={() => remove(c)} hitSlop={8}>
              <Text style={[styles.action, { color: colors.danger }]}>{t("social_delete")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );

  if (tops.length === 0) return <Text style={styles.muted}>{t("social_noComments")}</Text>;
  return (
    <View style={{ gap: space.md }}>
      {tops.map((c) => (
        <View key={c.id} style={{ gap: space.sm }}>
          {one(c)}
          {repliesOf(c.id).map((r) => one(r, true))}
        </View>
      ))}
    </View>
  );
}

/** 댓글 입력 줄: 답글 대상 표시 + 입력칸 + 보내기 */
export function CommentComposer({
  sid,
  replyTo,
  onCancelReply,
  onSent,
  onError,
}: {
  sid: string;
  replyTo: CommentItem | null;
  onCancelReply: () => void;
  onSent: () => void;
  onError: (msg: string) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    onError("");
    try {
      await addComment(sid, body, replyTo?.id);
      setText("");
      onCancelReply();
      onSent();
    } catch (err) {
      onError(t(authErrorKey(err).key as "error_network"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 6 }}>
      {replyTo ? (
        <View style={styles.replyBar}>
          <Ionicons name="return-down-forward-outline" size={16} color={colors.primary} />
          <Text style={styles.replyText} numberOfLines={1}>
            {t("social_replyTo", { name: replyTo.name ?? "?" })}
          </Text>
          <Pressable onPress={onCancelReply} hitSlop={8}>
            <Text style={styles.action}>{t("common_cancel")}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          maxLength={500}
          placeholder={replyTo ? t("social_replyPlaceholder") : t("social_placeholder")}
          placeholderTextColor={colors.faint}
          style={styles.input}
          accessibilityLabel={replyTo ? t("social_replyLabel") : t("social_commentLabel")}
        />
        <Pressable
          onPress={send}
          disabled={busy || !text.trim()}
          style={[styles.send, (busy || !text.trim()) && { opacity: 0.4 }]}
          accessibilityLabel={t("social_send")}
          hitSlop={6}
        >
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
        </Pressable>
      </View>
    </View>
  );
}

/** 갤러리에서 💬 를 누르면 아래에서 올라오는 댓글 창. 닫을 때 바뀐 댓글 수를 알려 준다 */
export function CommentSheet({ sid, onClose }: { sid: string | null; onClose: (count: number | null) => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<CommentItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    if (!sid) return;
    getSocial(sid)
      .then((d) => {
        setComments(d.comments);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [sid]);

  useEffect(() => {
    setComments(null);
    setReplyTo(null);
    setMsg("");
    load();
  }, [load]);

  const close = () => onClose(comments ? comments.length : null);

  return (
    <Modal visible={!!sid} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel={t("common_close")} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.md) }]}>
          <View style={styles.grip} />
          <View style={styles.sheetHead}>
            <Text style={styles.count}>{t("social_comments", { count: comments?.length ?? 0 })}</Text>
            <Pressable onPress={close} hitSlop={10} accessibilityLabel={t("common_close")}>
              <Ionicons name="close" size={22} color={colors.muted} />
            </Pressable>
          </View>
          <ScrollView style={styles.sheetList} contentContainerStyle={{ paddingBottom: space.md }} keyboardShouldPersistTaps="handled">
            {failed ? <Text style={styles.error}>{t("error_network")}</Text> : null}
            {!comments && !failed ? <ActivityIndicator color={colors.primary} /> : null}
            {comments ? <CommentList comments={comments} onReply={setReplyTo} onDeleted={load} onError={setMsg} /> : null}
          </ScrollView>
          {msg ? <Text style={styles.error}>{msg}</Text> : null}
          {sid ? (
            <CommentComposer sid={sid} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onSent={load} onError={setMsg} />
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14 },
  error: { color: colors.danger },
  count: { color: colors.text, fontWeight: "700", fontSize: 15 },
  comment: { flexDirection: "row", gap: space.sm },
  reply: { marginLeft: space.lg, paddingLeft: space.md, borderLeftWidth: 2, borderLeftColor: colors.border },
  commentHead: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  name: { color: colors.text, fontWeight: "700", fontSize: 14 },
  roleTag: { color: colors.primary, fontSize: 11, borderWidth: 1, borderColor: colors.primary, borderRadius: 6, paddingHorizontal: 4 },
  time: { color: colors.faint, fontSize: 11 },
  body: { color: colors.text, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: "row", gap: space.lg },
  action: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 6 },
  replyText: { color: colors.primary, fontSize: 13, flex: 1 },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    color: colors.text,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: 15,
  },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  sheetWrap: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "80%" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
  },
  grip: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetList: { maxHeight: 420 },
});
