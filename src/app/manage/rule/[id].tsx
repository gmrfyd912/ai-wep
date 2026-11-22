import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { AppButton, Card, Field, Screen, SectionTitle } from "@/components/ui";
import {
  RULE_KEYS,
  activateRule,
  authErrorKey,
  deleteRule,
  getRule,
  saveRule,
  type ManualRule,
  type RuleItem,
  type RuleKey,
  type RuleSet,
} from "@/lib/api";
import { SourceLine } from "@/components/RuleSource";
import { confirm } from "@/screens/Comments";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

/** 항목마다 고칠 수 있는 숫자 칸 (단위) */
const NUM_FIELDS: Record<RuleKey, { key: keyof RuleItem; unit: "mm" | "count" }[]> = {
  crack: [],
  porosity: [
    { key: "max_diameter_mm", unit: "mm" },
    { key: "max_count", unit: "count" },
    { key: "per_length_mm", unit: "mm" },
  ],
  undercut: [{ key: "max_length_mm", unit: "mm" }],
  overlap: [],
  spatter: [],
  width_variation: [{ key: "max_mm", unit: "mm" }],
  straightness: [{ key: "max_mm", unit: "mm" }],
};
const DEFECT_KEYS: RuleKey[] = ["crack", "porosity", "undercut", "overlap", "spatter"];

type Nums = Record<string, string>;
const n = (v: string) => Number(String(v).replace(",", "."));

function toNums(items: RuleSet["items"]): Nums {
  const out: Nums = {};
  RULE_KEYS.forEach((k) =>
    NUM_FIELDS[k].forEach((f) => {
      const v = items[k][f.key];
      out[`${k}.${String(f.key)}`] = v === null || v === undefined ? "" : String(v);
    }),
  );
  return out;
}

/** 시스템관리자: 선급규정 세트 확인·수정·적용 */
export default function RuleEditor() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const [rs, setRs] = useState<RuleSet | null>(null);
  const [name, setName] = useState("");
  const [society, setSociety] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<RuleSet["items"] | null>(null);
  const [nums, setNums] = useState<Nums>({});
  const [manual, setManual] = useState<ManualRule[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const apply = (x: RuleSet) => {
    setRs(x);
    setName(x.name);
    setSociety(x.society);
    setNotes(x.notes);
    setItems(x.items);
    setNums(toNums(x.items));
    setManual(x.manual);
    setDirty(false);
  };

  useEffect(() => {
    if (id) getRule(id).then(apply).catch((e) => setError(t(authErrorKey(e).key as "error_network")));
  }, [id, t]);

  if (user?.role !== "admin") return <Redirect href="/" />;
  if (!rs || !items) {
    return <Screen>{error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.primary} />}</Screen>;
  }

  const touch = () => {
    setDirty(true);
    setMsg("");
    setError("");
  };
  const setItem = (k: RuleKey, patch: Partial<RuleItem>) => {
    touch();
    setItems({ ...items, [k]: { ...items[k], ...patch } });
  };

  const build = () => {
    const out = { ...items };
    for (const k of RULE_KEYS) {
      const it = { ...out[k] };
      for (const f of NUM_FIELDS[k]) {
        const raw = (nums[`${k}.${String(f.key)}`] ?? "").trim();
        if (raw === "") {
          (it as Record<string, unknown>)[f.key] = null;
        } else if (!Number.isFinite(n(raw)) || n(raw) < 0) {
          return null;
        } else {
          (it as Record<string, unknown>)[f.key] = n(raw);
        }
      }
      out[k] = it;
    }
    return out;
  };

  const save = async (): Promise<boolean> => {
    const built = build();
    if (!built) {
      setError(t("crit_errNumbers"));
      return false;
    }
    if (!name.trim()) {
      setError(t("auth_err_no_name"));
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const x = await saveRule(rs.id, { name, society, notes, items: built, manual });
      apply(x);
      setMsg(t("crit_saved"));
      return true;
    } catch (e) {
      setError(t(authErrorKey(e).key as "error_network"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (on: boolean) => {
    if (dirty && !(await save())) return;
    setBusy(true);
    try {
      await activateRule(rs.id, on);
      setRs({ ...rs, active: on });
      setMsg(on ? t("rules_activated") : t("rules_deactivated"));
    } catch (e) {
      setError(t(authErrorKey(e).key as "error_network"));
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    confirm(t("rules_deleteTitle"), t("rules_deleteConfirm"), t("rules_delete"), t("common_cancel"), async () => {
      try {
        await deleteRule(rs.id);
        router.back();
      } catch (e) {
        setError(t(authErrorKey(e).key as "error_network"));
      }
    });

  const unitLabel = (u: "mm" | "count") => (u === "mm" ? "mm" : t("crit_unitCount"));

  return (
    <Screen>
      <Text style={styles.warn}>{t("rules_reviewHint")}</Text>

      <Card style={rs.active ? { borderColor: colors.success } : undefined}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.blockTitle}>{rs.active ? t("rules_activeNow") : t("rules_inactiveNow")}</Text>
            <Text style={styles.hint}>{t("rules_activeHint")}</Text>
          </View>
          <Switch
            value={rs.active}
            onValueChange={toggleActive}
            disabled={busy}
            accessibilityLabel={t("rules_applySwitch")}
            trackColor={{ true: colors.success, false: colors.border }}
          />
        </View>
      </Card>

      <Card>
        <Field label={t("rules_name")} value={name} onChangeText={(v) => (touch(), setName(v))} />
        <Field label={t("rules_society")} value={society} onChangeText={(v) => (touch(), setSociety(v))} placeholder="DNV, KR, ABS…" />
        {rs.files.length ? (
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>{t("rules_files")}</Text>
            {rs.files.map((f, i) => (
              <Pressable key={i} style={styles.fileRow} onPress={() => f.url && Linking.openURL(f.url)} disabled={!f.url}>
                <Ionicons name={f.type.includes("pdf") ? "document-text-outline" : "image-outline"} size={18} color={colors.primary} />
                <Text style={styles.fileName} numberOfLines={1}>
                  {i + 1}. {f.name || "-"} {f.type.includes("pdf") ? `(${t("rules_pages", { count: f.pages })})` : ""}
                </Text>
                {f.url ? <Ionicons name="open-outline" size={16} color={colors.faint} /> : null}
              </Pressable>
            ))}
            <Text style={styles.hint}>{t("rules_filesHint")}</Text>
          </View>
        ) : null}
        {notes ? (
          <View style={{ gap: 4 }}>
            <Text style={styles.label}>{t("rules_aiNotes")}</Text>
            <Text style={styles.hint}>{notes}</Text>
          </View>
        ) : null}
      </Card>

      <SectionTitle>{t("rules_photoItems")}</SectionTitle>
      <Text style={styles.hint}>{t("rules_photoItemsHint")}</Text>
      {RULE_KEYS.map((k) => {
        const it = items[k];
        const isDefect = DEFECT_KEYS.includes(k);
        return (
          <Card key={k} style={it.check ? undefined : styles.off}>
            <View style={styles.switchRow}>
              <Text style={styles.blockTitle}>{t(`rules_item_${k}` as "rules_item_crack")}</Text>
              <Text style={styles.hint}>{it.check ? t("rules_judge") : t("rules_notJudge")}</Text>
              <Switch
                value={it.check}
                onValueChange={(v) => setItem(k, { check: v })}
                accessibilityLabel={t(`rules_item_${k}` as "rules_item_crack")}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
            {it.check && isDefect ? (
              k === "crack" ? (
                <Text style={styles.rule}>{t("rules_crackNever")}</Text>
              ) : (
                <View style={styles.switchRow}>
                  <Text style={styles.numLabel}>{it.allowed ? t("rules_allowedWithin") : t("rules_notAllowed")}</Text>
                  <Switch
                    value={!!it.allowed}
                    onValueChange={(v) => setItem(k, { allowed: v })}
                    accessibilityLabel={t("rules_allowedSwitch")}
                    trackColor={{ true: colors.primary, false: colors.danger }}
                  />
                </View>
              )
            ) : null}
            {it.check && (!isDefect || it.allowed)
              ? NUM_FIELDS[k].map((f) => {
                  const key = `${k}.${String(f.key)}`;
                  const label = t(`rules_f_${String(f.key)}` as "rules_f_max_mm");
                  return (
                    <View style={styles.numRow} key={key}>
                      <Text style={styles.numLabel}>{label}</Text>
                      <TextInput
                        style={styles.numInput}
                        value={nums[key]}
                        onChangeText={(v) => (touch(), setNums({ ...nums, [key]: v }))}
                        keyboardType="decimal-pad"
                        placeholder="-"
                        placeholderTextColor={colors.faint}
                        accessibilityLabel={label}
                        selectTextOnFocus
                      />
                      <Text style={styles.unit}>{unitLabel(f.unit)}</Text>
                    </View>
                  );
                })
              : null}
            {it.check && NUM_FIELDS[k].length && (!isDefect || it.allowed) ? (
              <Text style={styles.hint}>{t(k === "porosity" ? "rules_porosityHint" : "rules_blankHint")}</Text>
            ) : null}
            {it.check ? <SourceLine source={it.source} /> : null}
            {it.check && it.note ? <Text style={styles.hint}>{it.note}</Text> : null}
          </Card>
        );
      })}

      <SectionTitle>{t("rules_manualTitle")}</SectionTitle>
      <Text style={styles.hint}>{t("rules_manualHint")}</Text>
      {manual.map((m, i) => (
        <Card key={i}>
          <View style={styles.switchRow}>
            <Text style={styles.label}>
              {t("rules_manualItem")} {i + 1}
            </Text>
            <Pressable
              onPress={() => (touch(), setManual(manual.filter((_, j) => j !== i)))}
              hitSlop={10}
              accessibilityLabel={t("rules_removeItem")}
            >
              <Ionicons name="trash-outline" size={18} color={colors.faint} />
            </Pressable>
          </View>
          <Field
            label={t("rules_manualName")}
            value={m.name}
            onChangeText={(v) => (touch(), setManual(manual.map((x, j) => (j === i ? { ...x, name: v } : x))))}
          />
          <Field
            label={t("rules_manualRule")}
            value={m.rule}
            multiline
            onChangeText={(v) => (touch(), setManual(manual.map((x, j) => (j === i ? { ...x, rule: v } : x))))}
          />
          <SourceLine source={m.source} />
        </Card>
      ))}
      <AppButton
        label={t("rules_addManual")}
        icon="add-outline"
        variant="secondary"
        onPress={() => (touch(), setManual([...manual, { name: "", rule: "", source: null }]))}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {msg ? <Text style={{ color: colors.success }}>{msg}</Text> : null}
      <AppButton label={busy ? t("auth_working") : t("common_save")} icon="save-outline" onPress={save} disabled={busy || !dirty} />
      {rs.updated_at ? (
        <Text style={styles.hint}>
          {t("crit_lastChanged", { date: new Date(rs.updated_at).toLocaleString(i18n.language), name: rs.updated_by ?? "?" })}
        </Text>
      ) : null}

      {/* 위험한 버튼은 맨 아래에 떨어뜨려 둔다 */}
      <View style={styles.dangerZone}>
        <AppButton label={t("rules_delete")} icon="trash-outline" variant="danger" onPress={remove} disabled={busy || rs.active} />
        {rs.active ? <Text style={styles.hint}>{t("rules_deleteActive")}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  warn: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, fontSize: 14 },
  label: { color: colors.text, fontSize: 13, fontWeight: "700", flex: 1 },
  rule: { color: colors.text, fontSize: 14 },
  blockTitle: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 },
  off: { opacity: 0.6 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
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
  unit: { color: colors.muted, fontSize: 13, width: 40 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  fileName: { color: colors.text, fontSize: 13, flex: 1 },
  dangerZone: { marginTop: space.xl, gap: space.xs },
});
