import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { AppButton, Card, Chips, Field, Screen, SectionTitle } from "@/components/ui";
import {
  NEXT_TEST_KINDS,
  RULE_KEYS,
  activateRule,
  authErrorKey,
  deleteRule,
  getRule,
  saveRule,
  type Joint,
  type ManualRule,
  type RuleItem,
  type RuleOptions,
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
  undercut: [
    { key: "max_length_mm", unit: "mm" },
    { key: "max_depth_mm", unit: "mm" },
  ],
  overlap: [],
  spatter: [],
  width_variation: [{ key: "max_mm", unit: "mm" }],
  straightness: [{ key: "max_mm", unit: "mm" }],
};
const DEFECT_KEYS: RuleKey[] = ["crack", "porosity", "undercut", "overlap", "spatter"];

type Nums = Record<string, string>;
const n = (v: string) => Number(String(v).replace(",", "."));
const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** 교사 확인 항목 편집용: 공식 숫자는 글자로 들고 있다가 저장할 때 바꾼다 */
type MEdit = ManualRule & { fb: string; fc: string; fx: string; calc: boolean };
const toEdit = (m: ManualRule): MEdit => ({
  ...m,
  joint: m.joint ?? "",
  calc: !!m.formula,
  fb: str(m.formula?.base),
  fc: str(m.formula?.coef),
  fx: str(m.formula?.cap),
});

const isNum = (v: string) => v.trim() !== "" && Number.isFinite(n(v));
const calcReady = (m: MEdit) => m.calc && isNum(m.fb) && isNum(m.fc);

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
  const [manual, setManual] = useState<MEdit[]>([]);
  const [options, setOptions] = useState<RuleOptions | null>(null);
  const [zone, setZone] = useState("");
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
    setManual(x.manual.map(toEdit));
    setOptions(x.options);
    setZone(str(x.options?.plate_zone_mm));
    setDirty(false);
  };

  useEffect(() => {
    if (id) getRule(id).then(apply).catch((e) => setError(t(authErrorKey(e).key as "error_network")));
  }, [id, t]);

  if (user?.role !== "admin") return <Redirect href="/" />;
  if (!rs || !items || !options) {
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

  const setM = (i: number, patch: Partial<MEdit>) => (touch(), setManual(manual.map((x, j) => (j === i ? { ...x, ...patch } : x))));
  const setOpt = (patch: Partial<RuleOptions>) => (touch(), setOptions({ ...options, ...patch }));

  /** 교사 확인 항목·설정 숫자 확인 (이상하면 null) */
  const buildRest = () => {
    const ok = (v: string) => v.trim() === "" || (Number.isFinite(n(v)) && n(v) >= 0);
    const outM: ManualRule[] = [];
    for (const m of manual) {
      if (m.calc && ![m.fb, m.fc, m.fx].every(ok)) return null;
      const { fb, fc, fx, calc, ...rest } = m;
      const has = calc && fb.trim() !== "" && fc.trim() !== "";
      outM.push({ ...rest, formula: has ? { base: n(fb), coef: n(fc), cap: fx.trim() ? n(fx) : null } : null });
    }
    if (!ok(zone)) return null;
    return { manual: outM, options: { ...options, plate_zone_mm: zone.trim() ? n(zone) : null } };
  };

  const save = async (): Promise<boolean> => {
    const built = build();
    const rest = buildRest();
    if (!built || !rest) {
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
      const x = await saveRule(rs.id, { name, society, notes, items: built, ...rest });
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
              <Text style={styles.hint}>
                {t(k === "porosity" ? "rules_porosityHint" : k === "undercut" ? "rules_undercutHint" : "rules_blankHint")}
              </Text>
            ) : null}
            {it.check ? <SourceLine source={it.source} /> : null}
            {it.check && it.note ? <Text style={styles.hint}>{it.note}</Text> : null}
          </Card>
        );
      })}

      <SectionTitle>{t("rules_optionsTitle")}</SectionTitle>
      <Card>
        <View style={styles.numRow}>
          <Text style={styles.numLabel}>{t("rules_plateZone")}</Text>
          <TextInput
            style={styles.numInput}
            value={zone}
            onChangeText={(v) => (touch(), setZone(v))}
            keyboardType="decimal-pad"
            placeholder="-"
            placeholderTextColor={colors.faint}
            accessibilityLabel={t("rules_plateZone")}
            selectTextOnFocus
          />
          <Text style={styles.unit}>mm</Text>
        </View>
        <Text style={styles.hint}>{t("rules_plateZoneHint")}</Text>
        <View style={styles.switchRow}>
          <Text style={styles.numLabel}>{t("rules_crackEndsLabel")}</Text>
          <Switch
            value={options.crack_ends}
            onValueChange={(v) => setOpt({ crack_ends: v })}
            accessibilityLabel={t("rules_crackEndsLabel")}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>
        <Text style={styles.label}>{t("rules_nextTests")}</Text>
        {NEXT_TEST_KINDS.map((k) => (
          <Field
            key={k}
            label={t(`rules_kind_${k}` as "rules_kind_plate_butt")}
            value={options.next_tests[k]}
            placeholder={t("rules_nextTestPlaceholder")}
            onChangeText={(v) => setOpt({ next_tests: { ...options.next_tests, [k]: v } })}
          />
        ))}
      </Card>

      <SectionTitle>{t("rules_manualTitle")}</SectionTitle>
      <Text style={styles.hint}>{t("rules_manualHint")}</Text>
      {manual.map((m, i) => (
        <Card key={i}>
          <View style={styles.switchRow}>
            <Text style={styles.label}>
              {t("rules_manualItem")} {i + 1}
            </Text>
            {calcReady(m) ? (
              <View style={styles.badge}>
                <Ionicons name="calculator-outline" size={12} color={colors.primary} />
                <Text style={styles.badgeText}>{t("rules_calcBadge")}</Text>
              </View>
            ) : null}
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
            onChangeText={(v) => setM(i, { name: v })}
          />
          <Field
            label={t("rules_manualRule")}
            value={m.rule}
            multiline
            onChangeText={(v) => setM(i, { rule: v })}
          />
          <Text style={styles.label}>{t("rules_manualJoint")}</Text>
          <Chips<Joint>
            options={[
              { value: "", label: t("rules_jointBoth") },
              { value: "butt", label: t("rules_jointButt") },
              { value: "fillet", label: t("rules_jointFillet") },
            ]}
            value={m.joint ?? ""}
            onChange={(v) => setM(i, { joint: v })}
          />
          <Text style={styles.hint}>{t("rules_jointHint")}</Text>
          <View style={styles.switchRow}>
            <Text style={styles.label}>{t("rules_calcToggle")}</Text>
            <Switch
              value={m.calc}
              onValueChange={(v) => setM(i, { calc: v })}
              accessibilityLabel={t("rules_calcToggle")}
            />
          </View>
          {!m.calc ? (
            <Text style={styles.hint}>{t("rules_calcOffHint")}</Text>
          ) : (
            <View style={styles.calcBox}>
              <Text style={styles.rule}>{t("rules_formula")}</Text>
              <View style={[styles.numRow, { alignItems: "flex-end" }]}>
                {(
                  [
                    ["fb", "rules_fBase"],
                    ["fc", "rules_fCoef"],
                    ["fx", "rules_fCap"],
                  ] as const
                ).map(([f, label]) => (
                  <View key={f} style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.hint}>{t(label)}</Text>
                    <TextInput
                      style={[styles.numInput, { width: "100%" }]}
                      value={m[f]}
                      onChangeText={(v) => setM(i, { [f]: v })}
                      keyboardType="decimal-pad"
                      placeholder="-"
                      placeholderTextColor={colors.faint}
                      accessibilityLabel={t(label)}
                      selectTextOnFocus
                    />
                  </View>
                ))}
              </View>
              {(() => {
                const lim = (w: number) => {
                  const h = n(m.fb) + n(m.fc) * w;
                  return (m.fx.trim() && Number.isFinite(n(m.fx)) ? Math.min(h, n(m.fx)) : h).toFixed(1);
                };
                const ready = calcReady(m);
                return (
                  <Text style={ready ? styles.preview : styles.warn}>
                    {ready ? t("rules_calcPreview", { w1: 10, h1: lim(10), w2: 20, h2: lim(20) }) : t("rules_calcNeedAB")}
                  </Text>
                );
              })()}
              <Text style={styles.hint}>{t("rules_formulaHint")}</Text>
            </View>
          )}
          <SourceLine source={m.source} />
        </Card>
      ))}
      <AppButton
        label={t("rules_addManual")}
        icon="add-outline"
        variant="secondary"
        onPress={() => (touch(), setManual([...manual, toEdit({ name: "", rule: "", source: null, joint: "", formula: null })]))}
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
  preview: { color: colors.primary, fontSize: 13, fontWeight: "700", lineHeight: 19 },
  calcBox: { gap: space.xs, padding: space.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, borderWidth: 1, borderColor: colors.primary },
  badgeText: { color: colors.primary, fontSize: 11, fontWeight: "700" },
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
