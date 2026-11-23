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
  const review = cj.verdict === "review";
  const vc = cj.verdict == null ? colors.muted : pass ? colors.success : review ? colors.warning : colors.danger;
  const vbg = cj.verdict == null ? colors.cardAlt : pass ? "#0F2A1A" : review ? "#2A2210" : "#2A1212";
  const vText =
    cj.verdict == null ? t("rules_noVerdict") : review ? t("rules_review") : t(pass ? "report_pass" : "report_fail");
  const unit = (it: ClassJudgmentItem, v: number) => (it.unit === "mm" ? `${v} mm` : t("rules_countN", { n: v }));

  const line = (it: ClassJudgmentItem) => {
    const name = t(`rules_item_${it.key}` as "rules_item_crack");
    let what =
      it.check === "max" || it.check === "none" || it.check === "allowed"
        ? name
        : `${name} ${t(`rules_c_${it.check}` as "rules_c_count")}`;
    if (it.ends) what += ` ${t("rules_crackEnds")}`;
    let limit = "";
    if (it.check === "depth") {
      // 깊이는 사진으로 못 잼: 보였는지만, 기준은 교사 확인
      return {
        what,
        value: it.measured ? t("rules_seenN", { n: it.measured }) : t("rules_notSeen"),
        limit: t("rules_depthLimit", { mm: it.limit }),
      };
    }
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
            {[cj.society, cj.name, cj.joint ? t(cj.joint === "fillet" ? "rules_jointFillet" : "rules_jointButt") : ""]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>
        <View style={[styles.verdict, { borderColor: vc, backgroundColor: vbg }]}>
          <Text style={[styles.verdictText, { color: vc }]}>{vText}</Text>
        </View>
      </View>
      {review ? <Text style={[styles.note, { color: colors.warning }]}>{t("rules_reviewNote")}</Text> : null}
      {cj.zone ? (
        <Text style={styles.scope}>
          {t("rules_zoneLine", { len: cj.zone.length_mm, a: cj.zone.start_mm, b: cj.zone.end_mm })}
        </Text>
      ) : null}
      {cj.pipe_partial ? <Text style={styles.scope}>{t("rules_pipePartial")}</Text> : null}

      {cj.items.length ? (
        <View style={styles.legendRow}>
          <Text style={[styles.colHead, { flex: 1 }]}>{t("rules_colItem")}</Text>
          <Text style={[styles.colHead, styles.colValue]}>{t("rules_colMeasured")}</Text>
          <Text style={[styles.colHead, styles.colLimit]}>{t("rules_colLimit")}</Text>
        </View>
      ) : null}
      {cj.items.map((it, i) => {
        const l = line(it);
        const ic = it.ok === null ? "alert-circle" : it.ok ? "checkmark-circle" : "close-circle";
        const icc = it.ok === null ? colors.warning : it.ok ? colors.success : colors.danger;
        return (
          <Pressable key={`${it.key}-${it.check}`} onPress={() => setOpen(open === i ? null : i)} style={styles.item}>
            <View style={styles.itemRow}>
              <Ionicons name={ic} size={18} color={icc} />
              <Text style={styles.what}>{l.what}</Text>
              <Text style={[styles.value, styles.colValue, it.ok !== true && { color: icc }]}>{l.value}</Text>
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
            <View key={i} style={{ gap: 2 }}>
              <Text style={styles.manualItem}>• {[m.name, m.rule].filter(Boolean).join(": ")}</Text>
              {m.limit_mm != null ? (
                <Text style={styles.manualLimit}>{t("rules_limitFor", { mm: m.limit_mm.toFixed(1), b: m.basis_mm?.toFixed(1) })}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {cj.next_test ? <Text style={styles.next}>{t("rules_nextTestLine", { tests: cj.next_test })}</Text> : null}
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
  manualLimit: { color: colors.warning, fontSize: 13, fontWeight: "700", paddingLeft: 12 },
  scope: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  next: { color: colors.text, fontSize: 12, lineHeight: 17 },
  note: { color: colors.faint, fontSize: 11, lineHeight: 16 },
});
