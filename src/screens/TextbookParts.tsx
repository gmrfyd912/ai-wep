import type { TFunction } from "i18next";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { authErrorKey, type AdminTextbook } from "@/lib/api";
import { colors, space } from "@/theme";

/** 교재 화면 오류 문구 (서버가 준 숫자도 함께 넣는다) */
export function textbookError(t: TFunction, e: unknown) {
  const { key } = authErrorKey(e);
  const d = (e as { detail?: { max?: number; max_mb?: number; pages?: number; why?: string } }).detail;
  const msg = t(key as "error_network", { max: d?.max, max_mb: d?.max_mb, pages: d?.pages });
  return d?.why ? `${msg}\n(${d.why})` : msg;
}

/** 가로 진행 막대 (0~1) */
export function ProgressBar({ ratio, color = colors.primary }: { ratio: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: color }]} />
    </View>
  );
}

type Kind = "running" | "stopped" | "ready" | "failed";
const KIND_COLOR: Record<Kind, string> = {
  running: colors.primary,
  stopped: colors.faint,
  ready: colors.success,
  failed: colors.danger,
};

export function bookKind(b: AdminTextbook): Kind {
  if (b.status === "ready") return "ready";
  if (b.status === "failed") return "failed";
  return b.running ? "running" : "stopped";
}

/** 교재 상태 한 줄 + 나누기 막대 */
export function BookStatus({ book }: { book: AdminTextbook }) {
  const { t } = useTranslation();
  const kind = bookKind(book);
  const label = t(`tb_status_${kind}` as "tb_status_ready", { done: book.processed, pages: book.pages });
  return (
    <View style={{ gap: space.xs }}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: KIND_COLOR[kind] }]} />
        <Text style={[styles.label, { color: KIND_COLOR[kind] }]}>{label}</Text>
      </View>
      {kind !== "ready" ? <ProgressBar ratio={book.pages ? book.processed / book.pages : 0} color={KIND_COLOR[kind]} /> : null}
    </View>
  );
}

/** 범례: 상태 색 + 별 */
export function StatusLegend() {
  const { t } = useTranslation();
  const kinds: Kind[] = ["running", "stopped", "ready", "failed"];
  return (
    <View style={styles.legend}>
      {kinds.map((k) => (
        <View key={k} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: KIND_COLOR[k] }]} />
          <Text style={styles.legendText}>{t(`tb_legend_${k}` as "tb_legend_ready")}</Text>
        </View>
      ))}
      <View style={styles.row}>
        <Text style={{ color: colors.primary, fontSize: 12 }}>★</Text>
        <Text style={styles.legendText}>{t("tb_legend_current")}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  label: { fontSize: 13, fontWeight: "600" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: space.md, paddingVertical: space.sm },
  legendText: { color: colors.muted, fontSize: 12 },
});
