import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton } from "@/components/ui";
import { approveMember, authErrorKey, resetMemberPassword, type Member } from "@/lib/api";
import { colors, space } from "@/theme";

/** 가입 승인·비밀번호 초기화 버튼 (회원 관리 권한자, 같은 반 교사) */
export function MemberActions({ member, onChanged }: { member: Member; onChanged: () => void }) {
  const { t } = useTranslation();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<string>) => {
    setMsg(null);
    setBusy(true);
    try {
      const text = await fn();
      setMsg({ ok: true, text });
      onChanged();
    } catch (e) {
      setMsg({ ok: false, text: t(authErrorKey(e).key as "error_network") });
    } finally {
      setBusy(false);
    }
  };

  const reset = () =>
    Alert.alert(t("manage_resetPw"), t("manage_resetConfirm", { name: member.name }), [
      { text: t("common_cancel"), style: "cancel" },
      {
        text: t("manage_resetPw"),
        onPress: () =>
          run(async () => {
            const r = await resetMemberPassword(member.id);
            return t("manage_resetDone", { password: r.password });
          }),
      },
    ]);

  return (
    <View style={{ gap: space.sm }}>
      {member.status === "pending" ? (
        <AppButton
          label={t("admin_memberApprove")}
          onPress={() => run(async () => (await approveMember(member.id), t("manage_approved")))}
          disabled={busy}
        />
      ) : null}
      <AppButton label={t("manage_resetPw")} icon="key-outline" variant="secondary" onPress={reset} disabled={busy} />
      {msg ? <Text style={{ color: msg.ok ? colors.success : colors.danger }}>{msg.text}</Text> : null}
    </View>
  );
}

/** 승인 대기·사용 중지 표시 (사용 중이면 표시 없음) */
export function StatusBadge({ status }: { status: Member["status"] }) {
  const { t } = useTranslation();
  if (status === "active") return null;
  const pending = status === "pending";
  return (
    <Text style={{ color: pending ? colors.warning : colors.danger, fontSize: 13, fontWeight: "700" }}>
      {pending ? t("admin_memberPending") : status === "graduated" ? t("manage_statusGraduated") : t("manage_statusDisabled")}
    </Text>
  );
}
