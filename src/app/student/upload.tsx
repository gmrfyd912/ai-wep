import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslation } from "react-i18next";

import { PipeOdTable } from "@/components/PipeOdTable";
import { AppButton, Body, Card, Chips, Label, Screen, SectionTitle } from "@/components/ui";
import { analyzePhoto, getProgress, NetworkError, newJobId, STAGES, wakeServer, type Stage } from "@/lib/api";
import { PROCESSES, WORK_TYPES, getLastWorkType, positionsOf, setLastWorkType, type WorkType } from "@/lib/weld";
import { colors, radius, space } from "@/theme";

// 공정·자세·재질 값은 영어 코드로 저장한다. 화면 표시는 국제 표준 약어(언어와 무관).

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
  const [work, setWork] = useState<WorkType>("plate");
  const [od, setOd] = useState("");
  const [odTable, setOdTable] = useState(false);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("wake");
  const [uploadPct, setUploadPct] = useState(0);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    getLastWorkType().then(setWork);
  }, []);

  const changeWork = (w: WorkType) => {
    setWork(w);
    setError(null);
    // 그 종류에 없는 자세면 첫 자세로
    if (!positionsOf(w).includes(pos)) setPos(positionsOf(w)[0]);
  };
  const odNum = Number(od.replace(",", "."));
  const odOk = work === "plate" || (Number.isFinite(odNum) && odNum >= 10 && odNum <= 2000);

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
    if (!odOk) {
      setError(t("pipe_odRequired"));
      return;
    }
    setBusy(true);
    setError(null);
    // 분석 단계 목록이 보이도록 화면 맨 아래로 내린다
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    try {
      // 1) 사진 줄이기: 실패하면 원본 그대로 보낸다
      let send = photo;
      try {
        send = await shrink(photo);
      } catch (e) {
        console.warn("[upload] 사진 줄이기 실패, 원본으로 보냄:", e);
      }
      // 2) 서버 깨우기  3) 사진 올리기 → 서버 단계는 1초마다 조회
      setStage("wake");
      setUploadPct(0);
      await wakeServer();
      setStage("upload");
      const jobId = newJobId();
      poll.current = setInterval(async () => {
        const st = await getProgress(jobId);
        if (st && (STAGES as readonly string[]).includes(st)) {
          setStage((cur) => (STAGES.indexOf(st as Stage) > STAGES.indexOf(cur) ? (st as Stage) : cur));
        }
      }, 1000);
      const res = await analyzePhoto(
        send.uri,
        { process: proc, position: pos, material: mat, work_type: work, pipe_od_mm: od.replace(",", ".") },
        {
          jobId,
          onUploadProgress: (r) => {
            setUploadPct(Math.round(r * 100));
            if (r >= 1) setStage((cur) => (cur === "upload" ? "save_photo" : cur));
          },
        },
      );
      setPhoto(null);
      setLastWorkType(work);
      router.push(`/result/${res.id}`);
    } catch (e) {
      const code = e instanceof NetworkError ? e.code : `app: ${(e as Error)?.message ?? String(e)}`;
      console.warn("[upload] 분석 실패:", code);
      setError(`${t("error_network")}\n(${code})`);
    } finally {
      if (poll.current) clearInterval(poll.current);
      poll.current = null;
      setBusy(false);
    }
  }

  return (
    <Screen scrollRef={scrollRef}>
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
      <Label>{t("work_label")}</Label>
      <View style={styles.workRow}>
        {WORK_TYPES.map((w) => {
          const on = work === w;
          return (
            <Pressable
              key={w}
              onPress={() => changeWork(w)}
              disabled={busy}
              style={[styles.workBtn, on && styles.workBtnOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
            >
              <Ionicons name={w === "pipe" ? "ellipse-outline" : "square-outline"} size={18} color={on ? colors.text : colors.muted} />
              <Text style={[styles.workText, on && styles.workTextOn]}>{t(`work_${w}`)}</Text>
            </Pressable>
          );
        })}
      </View>
      <Label>{t("upload_process")}</Label>
      <Chips options={PROCESSES.map((v) => ({ value: v, label: v }))} value={proc} onChange={setProc} />
      <Label>{t("upload_position")}</Label>
      <Chips options={positionsOf(work).map((v) => ({ value: v, label: v }))} value={pos} onChange={setPos} />
      <Label>{t("upload_material")}</Label>
      <Chips options={MATERIALS.map((v) => ({ value: v, label: v }))} value={mat} onChange={setMat} />
      {work === "pipe" ? (
        <Card>
          <View style={styles.odRow}>
            <Text style={styles.odLabel}>{t("pipe_od")}</Text>
            <TextInput
              style={[styles.odInput, !odOk && od !== "" && { borderColor: colors.danger }]}
              value={od}
              onChangeText={(v) => (setOd(v), setError(null))}
              keyboardType="decimal-pad"
              placeholder="114.3"
              placeholderTextColor={colors.faint}
              accessibilityLabel={t("pipe_od")}
              maxLength={6}
            />
            <Text style={styles.odUnit}>mm</Text>
          </View>
          <AppButton label={t("pipe_openTable")} icon="list-outline" variant="secondary" onPress={() => setOdTable(true)} disabled={busy} />
          <Text style={styles.hint}>{t("pipe_odHint")}</Text>
          {pos.endsWith("F") ? <Text style={[styles.hint, { color: colors.warning }]}>{t("pipe_filletTemp")}</Text> : null}
        </Card>
      ) : null}
      <PipeOdTable
        visible={odTable}
        stainless={mat === "SS"}
        onClose={() => setOdTable(false)}
        onPick={(v) => {
          setOd(String(v));
          setOdTable(false);
          setError(null);
        }}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {busy ? (
        <Card style={styles.busy}>
          <ActivityIndicator color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Body>{t("upload_analyzing")}</Body>
            <Body muted>{t("upload_wakeHint")}</Body>
            <View style={styles.stages}>
              {STAGES.map((s, i) => {
                const cur = STAGES.indexOf(stage);
                const mark = i < cur ? "✓" : i === cur ? "▶" : "○";
                const color = i < cur ? colors.success : i === cur ? colors.text : colors.faint;
                const label = t(`stage_${s}`) + (s === "upload" && i === cur ? ` ${uploadPct}%` : "");
                return (
                  <Text key={s} style={[styles.stage, { color }]}>
                    {mark} {i + 1}. {label}
                  </Text>
                );
              })}
            </View>
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
  busy: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  stages: { marginTop: space.sm, gap: 4 },
  stage: { fontSize: 14 },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  workRow: { flexDirection: "row", gap: space.sm },
  workBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  workBtnOn: { borderColor: colors.primary, backgroundColor: colors.primaryDim },
  workText: { color: colors.muted, fontSize: 16, fontWeight: "700" },
  workTextOn: { color: colors.text },
  odRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  odLabel: { color: colors.text, fontSize: 15, fontWeight: "700", flex: 1 },
  odInput: {
    width: 100,
    color: colors.text,
    fontSize: 18,
    textAlign: "right",
    backgroundColor: colors.cardAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: space.sm,
    paddingVertical: 8,
  },
  odUnit: { color: colors.muted, fontSize: 14 },
});
