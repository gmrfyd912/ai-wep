import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Avatar } from "@/components/Avatar";
import { AppButton } from "@/components/ui";
import { colors, space } from "@/theme";

/** 고른 프로필 사진: 화면 미리보기 주소 + 서버로 보낼 줄인 JPEG */
export type PickedPhoto = { uri: string; base64: string };

const SIDE = 512; // 서버가 다시 256 정사각형으로 자른다

/** 카메라 또는 앨범에서 사진을 골라 작게 줄인다. 취소하면 null, 권한이 없으면 "denied" */
export async function pickProfilePhoto(fromCamera: boolean): Promise<PickedPhoto | null | "denied"> {
  const perm = fromCamera
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return "denied";
  const opts: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 1,
    exif: false,
    allowsEditing: true, // 휴대폰에서는 정사각형으로 자르는 화면이 나온다
    aspect: [1, 1],
  };
  const r = fromCamera ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const ctx = ImageManipulator.manipulate(a.uri);
  if (Math.min(a.width, a.height) > SIDE) ctx.resize(a.width <= a.height ? { width: SIDE } : { height: SIDE });
  const out = await (await ctx.renderAsync()).saveAsync({ compress: 0.85, format: SaveFormat.JPEG, base64: true });
  return { uri: out.uri, base64: out.base64 ?? "" };
}

/** 큰 둥근 미리보기 + [사진 찍기] [앨범에서 고르기] */
export function ProfilePhotoPicker({
  url,
  cacheKey,
  name,
  busy,
  onPick,
  onDenied,
}: {
  url?: string | null;
  cacheKey?: string | null;
  name?: string | null;
  busy?: boolean;
  onPick: (p: PickedPhoto) => void;
  onDenied: () => void;
}) {
  const { t } = useTranslation();
  const choose = async (camera: boolean) => {
    try {
      const p = await pickProfilePhoto(camera);
      if (p === "denied") onDenied();
      else if (p) onPick(p);
    } catch (e) {
      console.warn("[avatar] 사진 고르기 실패:", e);
    }
  };
  return (
    <View style={styles.wrap}>
      <Avatar url={url} cacheKey={cacheKey} name={name} size={96} />
      {!url ? <Text style={styles.hint}>{t("avatar_none")}</Text> : null}
      <View style={styles.buttons}>
        <View style={{ flex: 1 }}>
          <AppButton label={t("upload_takePhoto")} icon="camera-outline" variant="secondary" onPress={() => choose(true)} disabled={busy} />
        </View>
        <View style={{ flex: 1 }}>
          <AppButton label={t("upload_pickPhoto")} icon="images-outline" variant="secondary" onPress={() => choose(false)} disabled={busy} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: space.sm },
  hint: { color: colors.faint, fontSize: 12 },
  buttons: { flexDirection: "row", gap: space.sm, alignSelf: "stretch" },
});
