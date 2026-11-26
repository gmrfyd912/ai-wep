import { Redirect } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Platform, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Card, Chips, Field, Screen, SectionTitle } from "@/components/ui";
import { authErrorKey, getAdminSettings, saveAdminSettings, type AdminSettings, type OutlineMode } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

/** 입력칸은 글자로 들고 있다가 저장할 때 숫자로 바꾼다 */
type Form = Record<string, string>;

const NUM_KEYS = [
  "pass_score",
  "fail_score_cap",
  "width.points",
  "width.full_mm",
  "width.zero_mm",
  "straight.points",
  "straight.full_mm",
  "straight.zero_mm",
  "defects.points",
  "defects.porosity",
  "defects.undercut",
  "defects.overlap",
  "defects.spatter",
  "defects.other",
  "report_daily_limit",
  "tutor_daily_limit",
  "password_min_length",
] as const;

function get(o: AdminSettings, key: string): number {
  const [a, b] = key.split(".");
  const v = (o as unknown as Record<string, unknown>)[a];
  return b ? (v as Record<string, number>)[b] : (v as number);
}

function toForm(s: AdminSettings): Form {
  const f: Form = { reset_password: s.reset_password };
  NUM_KEYS.forEach((k) => (f[k] = String(get(s, k) ?? (k === "tutor_daily_limit" ? 50 : ""))));
  return f;
}

const n = (v: string) => Number(String(v).replace(",", "."));

function fromForm(f: Form, crack: boolean, outline: OutlineMode): AdminSettings | null {
  if (NUM_KEYS.some((k) => f[k].trim() === "" || !Number.isFinite(n(f[k])))) return null;
  return {
    pass_score: Math.round(n(f.pass_score)),
    fail_score_cap: Math.round(n(f.fail_score_cap)),
    width: { points: n(f["width.points"]), full_mm: n(f["width.full_mm"]), zero_mm: n(f["width.zero_mm"]) },
    straight: { points: n(f["straight.points"]), full_mm: n(f["straight.full_mm"]), zero_mm: n(f["straight.zero_mm"]) },
    defects: {
      points: n(f["defects.points"]),
      porosity: n(f["defects.porosity"]),
      undercut: n(f["defects.undercut"]),
      overlap: n(f["defects.overlap"]),
      spatter: n(f["defects.spatter"]),
      other: n(f["defects.other"]),
    },
    crack_fail: crack,
    report_daily_limit: Math.round(n(f.report_daily_limit)),
    tutor_daily_limit: Math.round(n(f.tutor_daily_limit)),
    outline_review: outline,
    password_min_length: Math.round(n(f.password_min_length)),
    reset_password: f.reset_password.trim(),
  };
}

/** 시스템관리자: 검사·운영 설정 (합격 점수, 검사기준, AI 리포트 한도, 비밀번호 규칙) */
export default function CriteriaScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [form, setForm] = useState<Form | null>(null);
  const [crack, setCrack] = useState(true);
  const [outline, setOutline] = useState<OutlineMode>("staff");
  const [meta, setMeta] = useState<{ at?: string | null; by?: string | null }>({});
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (s: AdminSettings) => {
    setForm(toForm(s));
    setCrack(s.crack_fail);
    setOutline(s.outline_review ?? "staff");
    setMeta({ at: s.updated_at, by: s.updated_by });
  };

  useEffect(() => {
    getAdminSettings()
      .then(apply)
      .catch((e) => setError(t(authErrorKey(e).key as "error_network")));
  }, [t]);

  if (user?.role !== "admin") return <Redirect href="/" />;
  if (!form) {
    return <Screen>{error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}</Screen>;
  }

  const set = (k: string) => (v: string) => {
    setMsg("");
    setForm({ ...form, [k]: v });
  };
  const num = (k: string, label: string, unit?: string) => (
    <View style={styles.numRow} key={k}>
      <Text style={styles.numLabel}>{label}</Text>
      <TextInput
        style={styles.numInput}
        value={form[k]}
        onChangeText={set(k)}
        keyboardType="decimal-pad"
        accessibilityLabel={label}
        selectTextOnFocus
      />
      <Text style={styles.unit}>{unit ?? ""}</Text>
    </View>
  );
  const total = n(form["width.points"]) + n(form["straight.points"]) + n(form["defects.points"]);
  const totalOk = Math.abs(total - 100) < 0.01;

  const doSave = async () => {
    const body = fromForm(form, crack, outline);
    if (!body) return setError(t("crit_errNumbers"));
    setBusy(true);
    setError("");
    try {
      const s = await saveAdminSettings(body);
      apply(s);
      setMsg(t("crit_saved"));
    } catch (e) {
      const { key, values } = authErrorKey(e);
      const detail = (e as { detail?: { total?: number } }).detail;
      setError(t(key as "error_network", { ...values, total: detail?.total }));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!totalOk) return setError(t("auth_err_points_sum", { total: Math.round(total * 10) / 10 }));
    // 지난 점수·랭킹도 바뀌니 한 번 더 묻는다
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(`${t("crit_confirmTitle")}\n${t("crit_confirm")}`)) doSave();
      return;
    }
    Alert.alert(t("crit_confirmTitle"), t("crit_confirm"), [
      { text: t("common_cancel"), style: "cancel" },
      { text: t("common_save"), onPress: doSave },
    ]);
  };

  return (
    <Screen>
      <Text style={styles.hint}>{t("crit_intro")}</Text>

      <SectionTitle>{t("crit_pass")}</SectionTitle>
      <Card>
        {num("pass_score", t("crit_passScore"), t("crit_unitPoint"))}
        <Text style={styles.hint}>{t("crit_passHint")}</Text>
        <View style={styles.switchRow}>
          <Text style={styles.numLabel}>{t("crit_crackFail")}</Text>
          <Switch value={crack} onValueChange={setCrack} trackColor={{ true: colors.primary, false: colors.border }} />
        </View>
        {crack ? num("fail_score_cap", t("crit_crackCap"), t("crit_unitPoint")) : null}
      </Card>

      <SectionTitle>{t("crit_scoreTitle")}</SectionTitle>
      <Text style={[styles.total, { color: totalOk ? colors.success : colors.danger }]}>
        {t("crit_total", { total: Number.isFinite(total) ? Math.round(total * 10) / 10 : "?" })}
      </Text>
      <Block title={t("crit_width")} hint={t("crit_ruleHint")}>
        {num("width.points", t("crit_points"), t("crit_unitPoint"))}
        {num("width.full_mm", t("crit_full"), "mm")}
        {num("width.zero_mm", t("crit_zero"), "mm")}
      </Block>
      <Block title={t("crit_straight")} hint={t("crit_ruleHint")}>
        {num("straight.points", t("crit_points"), t("crit_unitPoint"))}
        {num("straight.full_mm", t("crit_full"), "mm")}
        {num("straight.zero_mm", t("crit_zero"), "mm")}
      </Block>
      <Block title={t("crit_defects")} hint={t("crit_defectsHint")}>
        {num("defects.points", t("crit_points"), t("crit_unitPoint"))}
        {num("defects.porosity", t("defect_porosity"), t("crit_unitMinus"))}
        {num("defects.undercut", t("defect_undercut"), t("crit_unitMinus"))}
        {num("defects.overlap", t("defect_overlap"), t("crit_unitMinus"))}
        {num("defects.spatter", t("defect_spatter"), t("crit_unitMinus"))}
        {num("defects.other", t("crit_otherDefect"), t("crit_unitMinus"))}
      </Block>

      <SectionTitle>{t("crit_report")}</SectionTitle>
      <Card>
        {num("report_daily_limit", t("crit_reportLimit"), t("crit_unitCount"))}
        <Text style={styles.hint}>{t("crit_reportHint")}</Text>
        {num("tutor_daily_limit", t("crit_tutorLimit"), t("crit_unitCount"))}
        <Text style={styles.hint}>{t("crit_tutorHint")}</Text>
      </Card>

      <SectionTitle>{t("crit_outline")}</SectionTitle>
      <Card>
        <Chips<OutlineMode>
          options={[
            { value: "off", label: t("crit_outlineOff") },
            { value: "staff", label: t("crit_outlineStaff") },
            { value: "all", label: t("crit_outlineAll") },
          ]}
          value={outline}
          onChange={(v) => {
            setMsg("");
            setOutline(v);
          }}
        />
        <Text style={styles.hint}>{t("crit_outlineHint")}</Text>
      </Card>

      <SectionTitle>{t("crit_password")}</SectionTitle>
      <Card>
        {num("password_min_length", t("crit_pwMin"), t("crit_unitChars"))}
        <Text style={styles.hint}>{t("crit_pwMinHint")}</Text>
        <Field label={t("crit_resetPw")} value={form.reset_password} onChangeText={set("reset_password")} />
        <Text style={styles.hint}>{t("crit_resetPwHint")}</Text>
      </Card>

      <Text style={styles.warn}>{t("crit_confirm")}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {msg ? <Text style={{ color: colors.success }}>{msg}</Text> : null}
      <AppButton label={busy ? t("auth_working") : t("common_save")} icon="save-outline" onPress={save} disabled={busy} />
      {meta.at ? (
        <Text style={styles.hint}>
          {t("crit_lastChanged", { date: new Date(meta.at).toLocaleString(i18n.language), name: meta.by ?? "?" })}
        </Text>
      ) : null}
    </Screen>
  );
}

function Block({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card>
      <Text style={styles.blockTitle}>{title}</Text>
      {children}
      <Text style={styles.hint}>{hint}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  warn: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, fontSize: 14 },
  total: { fontSize: 14, fontWeight: "800" },
  blockTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
  numRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  numLabel: { color: colors.text, fontSize: 14, flex: 1 },
  numInput: {
    width: 76,
    color: colors.text,
    fontSize: 16,
    textAlign: "right",
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
  },
  unit: { color: colors.muted, fontSize: 13, width: 58 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, paddingVertical: 4 },
});
