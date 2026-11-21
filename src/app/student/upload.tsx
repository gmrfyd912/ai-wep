import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, Label, Screen, SectionTitle } from "@/components/ui";
import { analyzePhoto } from "@/lib/api";
import { colors, radius, space } from "@/theme";

// 공정·자세·재질 값은 영어 코드로 저장한다. 화면 표시는 국제 표준 약어(언어와 무관).
const PROCESSES = ["SMAW", "GTAW", "GMAW", "FCAW"] as const;
const POSITIONS = ["1G", "2G", "3G", "4G", "1F", "2F", "3F", "4F"] as const;
const MATERIALS = ["CS", "SS", "AL"] as const;

// 긴 변을 이 크기로 줄여 보낸다: 측정에 필요한 선명도는 남기고 전송만 빠르게.
const SEND_LONG_SIDE = 3000;

type Photo = { uri: string; width: number; height: number };

async function shrink(p: Photo): Promise<Photo> {
  const long = Math.max(p.width, p.height);
  const ctx = ImageManipulator.manipulate(p.uri);
  if (long > SEND_LONG_SIDE) {
    ctx.resize(p.width >= p.height ? { width: SEND_LONG_SIDE } : { height: SEND_LONG_SIDE });
  }
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: 0.92, format: SaveFormat.JPEG });
  return { uri: out.uri, width: out.width, height: out.height };
}

export default function UploadScreen() {
  const { t } = useTranslation();
  const [proc, setProc] = useState<string>("SMAW");
  const [pos, setPos] = useState<string>("1G");
  const [mat, setMat] = useState<string>("CS");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(fromCamera: boolean) {
    setError(null);
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError(t("upload_permissionDenied"));
      return;
    }
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, exif: false };
    const r = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setPhoto({ uri: a.uri, width: a.width, height: a.height });
  }

  async function analyze() {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      const small = await shrink(photo);
      const res = await analyzePhoto(small.uri, { process: proc, position: pos, material: mat });
      setPhoto(null);
      router.push(`/result/${res.id}`);
    } catch {
      setError(t("error_network"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("upload_guideTitle")}</SectionTitle>
        <Body>① {t("upload_guide1")}</Body>
        <Body>② {t("upload_guide2")}</Body>
        <Body>③ {t("upload_guide3")}</Body>
      </Card>

      {photo ? (
        <Image source={{ uri: photo.uri }} style={styles.preview} contentFit="contain" />
      ) : null}

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <AppButton label={t("upload_takePhoto")} icon="camera-outline" variant="secondary" disabled={busy} onPress={() => choose(true)} />
        </View>
        <View style={{ flex: 1 }}>
          <AppButton label={t("upload_pickPhoto")} icon="images-outline" variant="secondary" disabled={busy} onPress={() => choose(false)} />
        </View>
      </View>

      <SectionTitle>{t("upload_infoTitle")}</SectionTitle>
      <Label>{t("upload_process")}</Label>
      <Chips options={PROCESSES.map((v) => ({ value: v, label: v }))} value={proc} onChange={setProc} />
      <Label>{t("upload_position")}</Label>
      <Chips options={POSITIONS.map((v) => ({ value: v, label: v }))} value={pos} onChange={setPos} />
      <Label>{t("upload_material")}</Label>
      <Chips options={MATERIALS.map((v) => ({ value: v, label: v }))} value={mat} onChange={setMat} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {busy ? (
        <Card style={styles.busy}>
          <ActivityIndicator color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Body>{t("upload_analyzing")}</Body>
            <Body muted>{t("upload_wakeHint")}</Body>
          </View>
        </Card>
      ) : (
        <AppButton label={t("upload_analyze")} icon="sparkles-outline" disabled={!photo} onPress={analyze} />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { width: "100%", height: 260, borderRadius: radius.md, backgroundColor: colors.card },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  busy: { flexDirection: "row", alignItems: "center", gap: space.md },
});
