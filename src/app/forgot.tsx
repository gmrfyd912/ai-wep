import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, Field, Screen } from "@/components/ui";
import { goAfterLogin } from "@/lib/afterLogin";
import { authErrorKey, findId, resetPassword, sendResetCode } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors } from "@/theme";

type Tab = "id" | "pw";

/** 아이디 찾기(이메일로 아이디 받기) / 비밀번호 재설정(이메일로 6자리 번호 받기) */
export default function ForgotScreen() {
  const { t, i18n } = useTranslation();
  const { signIn } = useSession();
  const [tab, setTab] = useState<Tab>("id");
  const [email, setEmail] = useState("");
  const [loginId, setLoginId] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError("");
    setInfo("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const { key, values } = authErrorKey(e);
      setError(t(key as "error_network", values));
    } finally {
      setBusy(false);
    }
  };

  const sendId = () =>
    run(async () => {
      if (!email.trim()) {
        setError(t("auth_err_required"));
        return;
      }
      await findId(email.trim(), i18n.language);
      setInfo(t("forgot_idSent"));
    });

  const sendCode = () =>
    run(async () => {
      if (!loginId.trim()) {
        setError(t("auth_err_required"));
        return;
      }
      const r = await sendResetCode(loginId, i18n.language);
      setSentTo(r.email);
    });

  const reset = () =>
    run(async () => {
      if (pw !== pw2) {
        setError(t("signup_errorPasswordMatch"));
        return;
      }
      const r = await resetPassword(loginId, code, pw);
      await signIn(r.token, r.user);
      goAfterLogin(r.user, t);
    });

  return (
    <Screen>
      <Chips<Tab>
        options={[
          { value: "id", label: t("forgot_tabId") },
          { value: "pw", label: t("forgot_tabPw") },
        ]}
        value={tab}
        onChange={(v) => {
          setTab(v);
          setError("");
          setInfo("");
        }}
      />

      {tab === "id" ? (
        <>
          <Field label={t("forgot_email")} value={email} onChangeText={setEmail} keyboardType="email-address" autoCorrect={false} />
          <AppButton label={busy ? t("auth_working") : t("forgot_sendId")} onPress={sendId} disabled={busy} />
        </>
      ) : (
        <>
          <Field label={t("login_id")} value={loginId} onChangeText={setLoginId} autoCorrect={false} editable={!sentTo} />
          {!sentTo ? (
            <AppButton label={busy ? t("auth_working") : t("forgot_sendCode")} onPress={sendCode} disabled={busy} />
          ) : (
            <>
              <Body muted>{t("forgot_codeSent", { email: sentTo })}</Body>
              <Field label={t("forgot_code")} value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
              <Field label={t("pw_new")} value={pw} onChangeText={setPw} secureTextEntry />
              <Field label={t("pw_confirm")} value={pw2} onChangeText={setPw2} secureTextEntry />
              <AppButton label={busy ? t("auth_working") : t("forgot_reset")} onPress={reset} disabled={busy} />
              <AppButton label={t("forgot_sendCode")} variant="secondary" onPress={sendCode} disabled={busy} />
            </>
          )}
        </>
      )}

      {info ? <Text style={styles.info}>{info}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Card>
        <Body muted>{t("forgot_noEmailHelp")}</Body>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  info: { color: colors.success, fontSize: 14 },
  error: { color: colors.danger, fontSize: 14 },
});
