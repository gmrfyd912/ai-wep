import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Card, SectionTitle } from "@/components/ui";
import { EMOJIS, EMOJI_CHAR, authErrorKey, getSocial, setHidden, setReaction, type CommentItem, type Emoji, type Social } from "@/lib/api";
import { CommentComposer, CommentList, confirm } from "@/screens/Comments";
import { colors, radius, space } from "@/theme";

/** 결과 화면 아래: 반응 6가지 + 댓글·대댓글 + (교사·관리자) 갤러리에서 내리기 */
export function ResultSocial({ sid }: { sid: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Social | null>(null);
  const [failed, setFailed] = useState(false);
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
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

  return (
    <View style={{ gap: space.md }}>
      <SectionTitle>{t("social_title")}</SectionTitle>
      {data.hidden ? <Text style={styles.hiddenNote}>{t("social_hiddenNote")}</Text> : null}
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
        <CommentList comments={data.comments} onReply={setReplyTo} onDeleted={load} onError={setMsg} />
      </Card>
      <CommentComposer sid={sid} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onSent={load} onError={setMsg} />
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
});
