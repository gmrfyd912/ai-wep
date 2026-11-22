import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import type { RuleSource } from "@/lib/api";
import { colors, space } from "@/theme";

/** 출처 한 줄: "3쪽 · Table 4.2" + 원문 */
export function SourceLine({ source }: { source: RuleSource }) {
  const { t } = useTranslation();
  if (!source) return <Text style={styles.noSource}>{t("rules_noSource")}</Text>;
  const where = [source.page ? t("rules_page", { page: source.page }) : "", source.ref].filter(Boolean).join(" · ");
  return (
    <View style={styles.sourceBox}>
      {where ? (
        <Text style={styles.sourceWhere}>
          {t("rules_source")}: {where}
        </Text>
      ) : null}
      {source.quote ? <Text style={styles.quote}>“{source.quote}”</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  sourceBox: { backgroundColor: colors.cardAlt, borderRadius: 8, padding: space.sm, gap: 2 },
  sourceWhere: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  quote: { color: colors.muted, fontSize: 12, fontStyle: "italic", lineHeight: 17 },
  noSource: { color: colors.faint, fontSize: 12 },
});
