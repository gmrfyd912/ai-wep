import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { PIPE_OD_TABLE } from "@/lib/weld";
import { colors, radius, space } from "@/theme";

/** 배관 외경 규격표 팝업: 호칭을 누르면 외경(mm)이 들어간다. 재질이 SS면 STS 외경 */
export function PipeOdTable({
  visible,
  stainless,
  onPick,
  onClose,
}: {
  visible: boolean;
  stainless: boolean;
  onPick: (od: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{t("pipe_tableTitle")}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel={t("common_close")}>
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <Text style={styles.help}>{t("pipe_tableHelp")}</Text>
          <View style={[styles.row, styles.headerRow]}>
            <Text style={[styles.colA, styles.headText]}>{t("pipe_colA")}</Text>
            <Text style={[styles.colB, styles.headText]}>{t("pipe_colB")}</Text>
            <Text style={[styles.colOd, styles.headText, !stainless && styles.active]}>{t("pipe_colCarbon")}</Text>
            <Text style={[styles.colOd, styles.headText, stainless && styles.active]}>{t("pipe_colSts")}</Text>
          </View>
          <ScrollView style={{ maxHeight: 400 }}>
            {PIPE_OD_TABLE.map((r) => (
              <Pressable
                key={r.a}
                onPress={() => onPick(stainless ? r.ods : r.od)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.primaryDim }]}
                accessibilityLabel={`${r.a} ${stainless ? r.ods : r.od} mm`}
              >
                <Text style={[styles.colA, styles.nom]}>{r.a}</Text>
                <Text style={[styles.colB, styles.nom]}>{r.b}</Text>
                <Text style={[styles.colOd, styles.val, !stainless && styles.active]}>{r.od.toFixed(1)}</Text>
                <Text style={[styles.colOd, styles.val, stainless && styles.active]}>{r.ods.toFixed(1)}</Text>
              </Pressable>
            ))}
            <Text style={styles.foot}>{t("pipe_tableFoot")}</Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  help: { color: colors.muted, fontSize: 13 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: space.xs,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerRow: { paddingVertical: 6 },
  headText: { color: colors.faint, fontSize: 12, fontWeight: "700" },
  colA: { width: 56 },
  colB: { width: 64 },
  colOd: { flex: 1, textAlign: "right" },
  nom: { color: colors.danger, fontSize: 14, fontWeight: "700" },
  val: { color: colors.muted, fontSize: 14 },
  active: { color: colors.primary, fontWeight: "800" },
  foot: { color: colors.faint, fontSize: 12, marginTop: space.sm, lineHeight: 18 },
});
