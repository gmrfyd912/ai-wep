import Ionicons from "@expo/vector-icons/Ionicons";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { SourceLine } from "@/components/RuleSource";
import { Card } from "@/components/ui";
import type { ClassJudgment, ClassJudgmentItem } from "@/lib/api";
import { colors, radius, space } from "@/theme";

/** 결과 화면·AI 리포트: 적용 중인 선급규정으로 본 '선급 예비판정'. 100점 점수와 따로 보여 준다. */
export function ClassJudgmentCard({ cj }: { cj: ClassJudgment }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  const pass = cj.verdict === "pass";
  const vc = cj.verdict == null ? colors.muted : pass ? colors.success : colors.danger;
  const unit = (it: ClassJudgmentItem, v: number) => (it.unit === "mm" ? `${v} mm` : t("rules_countN", { n: v }));

  const line = (it: ClassJudgmentItem) => {
    const name = t(`rules_item_${it.key}` as "rules_item_crack");
    const what =
      it.check === "max" || it.check === "none" || it.check === "allowed"
        ? name
        : `${name} ${t(`rules_c_${it.check}` as "rules_c_count")}`;
    let limit = "";
    if (it.check === "none") limit = t("rules_notAllowedShort");
    else if (it.check === "allowed") limit = t("rules_allowedShort");
    else if (it.limit != null) {
      limit = `≤ ${unit(it, it.limit)}`;
      if (it.per_mm) limit += ` / ${it.per_mm} mm`;
    }
    return { what, value: unit(it, it.measured), limit };
  };

  return (
    <Card style={{ borderColor: vc }}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={styles.label}>{t("rules_cardTitle")}</Text>
          <Text style={styles.setName} numberOfLines={2}>
            {[cj.society, cj.name].filter(Boolean).join(" · ")}
          </Text>
        </View>
        <View style={[styles.verdict, { borderColor: vc, backgroundColor: cj.verdict == null ? colors.cardAlt : pass ? "#0F2A1A" : "#2A1212" }]}>
          <Text style={[styles.verdictText, { color: vc }]}>
            {cj.verdict == null ? t("rules_noVerdict") : t(pass ? "report_pass" : "report_fail")}
          </Text>
        </View>
      </View>

      {cj.items.length ? (
        <View style={styles.legendRow}>
          <Text style={[styles.colHead, { flex: 1 }]}>{t("rules_colItem")}</Text>
          <Text style={[styles.colHead, styles.colValue]}>{t("rules_colMeasured")}</Text>
          <Text style={[styles.colHead, styles.colLimit]}>{t("rules_colLimit")}</Text>
        </View>
      ) : null}
      {cj.items.map((it, i) => {
        const l = line(it);
        return (
          <Pressable key={`${it.key}-${it.check}`} onPress={() => setOpen(open === i ? null : i)} style={styles.item}>
            <View style={styles.itemRow}>
              <Ionicons name={it.ok ? "checkmark-circle" : "close-circle"} size={18} color={it.ok ? colors.success : colors.danger} />
              <Text style={styles.what}>{l.what}</Text>
              <Text style={[styles.value, styles.colValue, !it.ok && { color: colors.danger }]}>{l.value}</Text>
              <Text style={[styles.limit, styles.colLimit]}>{l.limit}</Text>
            </View>
            {open === i ? <SourceLine source={it.source} /> : null}
          </Pressable>
        );
      })}
      {cj.items.length ? <Text style={styles.note}>{t("rules_tapForSource")}</Text> : null}

      {cj.manual.length ? (
        <View style={styles.manual}>
          <View style={styles.itemRow}>
            <Ionicons name="person-outline" size={16} color={colors.warning} />
            <Text style={styles.manualTitle}>{t("rules_manualCard")}</Text>
          </View>
          {cj.manual.map((m, i) => (
            <Text key={i} style={styles.manualItem}>
              • {[m.name, m.rule].filter(Boolean).join(": ")}
            </Text>
          ))}
        </View>
      ) : null}
      <Text style={styles.note}>{t("rules_cardNote")}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  label: { color: colors.faint, fontSize: 11 },
  setName: { color: colors.text, fontSize: 15, fontWeight: "700" },
  verdict: { borderWidth: 1.5, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 4 },
  verdictText: { fontSize: 16, fontWeight: "800" },
  legendRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: 26 },
  colHead: { color: colors.faint, fontSize: 11 },
  colValue: { width: 64, flexShrink: 0, textAlign: "right" },
  colLimit: { width: 96, flexShrink: 0, textAlign: "right" },
  item: { gap: 4, paddingVertical: 2 },
  itemRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  what: { color: colors.text, fontSize: 14, flex: 1 },
  value: { color: colors.text, fontSize: 14, fontWeight: "700" },
  limit: { color: colors.muted, fontSize: 12 },
  manual: { gap: 4, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: space.sm },
  manualTitle: { color: colors.warning, fontSize: 13, fontWeight: "700", flex: 1 },
  manualItem: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  note: { color: colors.faint, fontSize: 11, lineHeight: 16 },
});
