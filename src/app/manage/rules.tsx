import * as DocumentPicker from "expo-document-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Redirect, router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";

import { AppButton, Card, Field, Screen, SectionTitle } from "@/components/ui";
import { authErrorKey, createRule, extractRule, listRules, type PickedFile, type RuleSetSummary } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors, space } from "@/theme";

const LONG_SIDE = 2000; // 규정 사진은 글자가 읽힐 만큼만 줄인다 (AI도 이보다 크게는 안 봄)

async function shrink(a: { uri: string; width: number; height: number }, i: number): Promise<PickedFile> {
  const ctx = ImageManipulator.manipulate(a.uri);
  if (Math.max(a.width, a.height) > LONG_SIDE) ctx.resize(a.width >= a.height ? { width: LONG_SIDE } : { height: LONG_SIDE });
  const out = await (await ctx.renderAsync()).saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
  return { uri: out.uri, name: `photo-${Date.now()}-${i}.jpg`, mimeType: "image/jpeg" };
}

/** 시스템관리자: 선급규정 목록 + 규정 파일 올리기(AI 초안) */
export default function RulesScreen() {
  const { t, i18n } = useTranslation();
  const { user } = useSession();
  const [rows, setRows] = useState<RuleSetSummary[] | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    listRules()
      .then((r) => setRows(r.items))
      .catch((e) => setError(t(authErrorKey(e).key as "error_network")));
  }, [t]);
  useFocusEffect(load);

  if (user?.role !== "admin") return <Redirect href="/" />;

  const errText = (e: unknown) => {
    const { key } = authErrorKey(e);
    const d = (e as { detail?: { max?: number; max_mb?: number } }).detail;
    return t(key as "error_network", { max: d?.max, max_mb: d?.max_mb });
  };

  const pickDocs = async () => {
    setError("");
    const r = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*"],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (r.canceled) return;
    const got = r.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType, file: a.file ?? null }));
    setFiles((f) => [...f, ...got]);
  };

  const pickPhotos = async (camera: boolean) => {
    setError("");
    const perm = camera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(t("upload_permissionDenied"));
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, exif: false, allowsMultipleSelection: !camera };
    const r = camera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled) return;
    const got = await Promise.all(r.assets.map((a, i) => shrink(a, i)));
    setFiles((f) => [...f, ...got]);
  };

  const runAi = async () => {
    if (!files.length) return setError(t("rules_errNoFiles"));
    setBusy(true);
    setError("");
    try {
      const rs = await extractRule(files, name.trim());
      setFiles([]);
      setName("");
      router.push(`/manage/rule/${rs.id}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const makeEmpty = async () => {
    setBusy(true);
    setError("");
    try {
      const rs = await createRule(name.trim() || t("rules_newName"));
      router.push(`/manage/rule/${rs.id}`);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.hint}>{t("rules_intro")}</Text>

      <SectionTitle>{t("rules_uploadTitle")}</SectionTitle>
      <Card>
        <Text style={styles.hint}>{t("rules_uploadHint")}</Text>
        <Field label={t("rules_nameOptional")} value={name} onChangeText={setName} placeholder={t("rules_namePlaceholder")} />
        <View style={styles.btnRow}>
          <View style={{ flex: 1 }}>
            <AppButton label={t("rules_pickFile")} icon="document-attach-outline" variant="secondary" onPress={pickDocs} disabled={busy} />
          </View>
        </View>
        <View style={styles.btnRow}>
          <View style={{ flex: 1 }}>
            <AppButton label={t("upload_takePhoto")} icon="camera-outline" variant="secondary" onPress={() => pickPhotos(true)} disabled={busy} />
          </View>
          <View style={{ flex: 1 }}>
            <AppButton label={t("upload_pickPhoto")} icon="images-outline" variant="secondary" onPress={() => pickPhotos(false)} disabled={busy} />
          </View>
        </View>
        {files.length ? (
          <View style={{ gap: 6 }}>
            <Text style={styles.label}>{t("rules_picked", { count: files.length })}</Text>
            {files.map((f, i) => (
              <View key={`${f.uri}-${i}`} style={styles.fileRow}>
                <Ionicons
                  name={(f.mimeType ?? "").includes("pdf") || /\.pdf$/i.test(f.name) ? "document-text-outline" : "image-outline"}
                  size={18}
                  color={colors.primary}
                />
                <Text style={styles.fileName} numberOfLines={1}>
                  {i + 1}. {f.name}
                </Text>
                <Pressable
                  onPress={() => setFiles(files.filter((_, j) => j !== i))}
                  hitSlop={10}
                  accessibilityLabel={t("rules_removeFile")}
                  disabled={busy}
                >
                  <Ionicons name="close-circle" size={20} color={colors.faint} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
        <AppButton
          label={busy ? t("rules_aiWorking") : t("rules_runAi")}
          icon="sparkles-outline"
          onPress={runAi}
          disabled={busy || !files.length}
        />
        {busy ? (
          <View style={styles.busy}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.hint}>{t("rules_aiWait")}</Text>
          </View>
        ) : null}
        <Pressable onPress={makeEmpty} disabled={busy} style={styles.linkBtn}>
          <Text style={styles.link}>{t("rules_makeEmpty")}</Text>
        </Pressable>
      </Card>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <SectionTitle>{t("rules_listTitle")}</SectionTitle>
      {!rows ? (
        <ActivityIndicator color={colors.primary} />
      ) : rows.length === 0 ? (
        <Text style={styles.hint}>{t("rules_empty")}</Text>
      ) : (
        rows.map((r) => (
          <Card key={r.id} onPress={() => router.push(`/manage/rule/${r.id}`)}>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={2}>
                {[r.society, r.name].filter(Boolean).join(" · ") || t("rules_noName")}
              </Text>
              {r.active ? (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeText}>{t("rules_active")}</Text>
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={18} color={colors.faint} />
            </View>
            <Text style={styles.hint}>
              {t("rules_counts", { checked: r.checked, manual: r.manual, files: r.files })}
              {r.updated_at ? ` · ${new Date(r.updated_at).toLocaleDateString(i18n.language)}` : ""}
            </Text>
          </Card>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  label: { color: colors.text, fontSize: 13, fontWeight: "700" },
  error: { color: colors.danger, fontSize: 14 },
  btnRow: { flexDirection: "row", gap: space.sm },
  fileRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  fileName: { color: colors.text, fontSize: 13, flex: 1 },
  busy: { flexDirection: "row", alignItems: "center", gap: space.sm },
  linkBtn: { alignSelf: "center", paddingVertical: 6 },
  link: { color: colors.primary, fontSize: 13, textDecorationLine: "underline" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 },
  activeBadge: { backgroundColor: colors.success, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  activeText: { color: "#04130A", fontSize: 11, fontWeight: "800" },
});
