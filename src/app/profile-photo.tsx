import { router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { useTranslation } from "react-i18next";

import { ProfilePhotoPicker, type PickedPhoto } from "@/components/ProfilePhoto";
import { AppButton, Body, Card, Screen } from "@/components/ui";
import { goAfterLogin } from "@/lib/afterLogin";
import { authErrorKey, uploadAvatar } from "@/lib/api";
import { useSession } from "@/state/session";
import { colors } from "@/theme";

/** 프로필 사진 올리기·바꾸기. 사진이 필수인데 없는 회원은 로그인 뒤 이 화면이 먼저 나온다 */
export default function ProfilePhotoScreen() {
  const { t } = useTranslation();
  const { user, setUser } = useSession();
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!user) return null;
  const forced = !!user.needs_avatar;

  const save = async () => {
    if (!photo) return;
    setBusy(true);
    setError("");
    try {
      const me = await uploadAvatar(photo.uri);
      setUser(me);
      if (forced) {
        goAfterLogin(me, t);
      } else {
        Alert.alert(t("avatar_title"), t("avatar_saved"));
        router.back();
      }
    } catch (e) {
      const { key, values } = authErrorKey(e);
      setError(t(key as "error_network", values));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {forced ? (
        <Card style={{ borderColor: colors.warning }}>
          <Body>{t("avatar_forcedDesc")}</Body>
        </Card>
      ) : null}
      <ProfilePhotoPicker
        url={photo?.uri ?? user.avatar_url}
        cacheKey={photo ? null : user.avatar_key}
        name={user.name}
        busy={busy}
        onPick={setPhoto}
        onDenied={() => setError(t("upload_permissionDenied"))}
      />
      <Text style={styles.hint}>{t("avatar_hint")}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <AppButton label={busy ? t("auth_working") : t("avatar_save")} icon="checkmark-outline" onPress={save} disabled={busy || !photo} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { color: colors.muted, fontSize: 13, textAlign: "center" },
  error: { color: colors.danger, fontSize: 14 },
});
