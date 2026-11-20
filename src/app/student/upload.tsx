import { useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton, Body, Card, Chips, ComingSoon, Label, Screen, SectionTitle } from "@/components/ui";
import { space } from "@/theme";

// 공정·자세·재질 값은 영어 코드로 저장한다. 화면 표시는 국제 표준 약어(언어와 무관).
const PROCESSES = ["SMAW", "GTAW", "GMAW", "FCAW"] as const;
const POSITIONS = ["1G", "2G", "3G", "4G", "1F", "2F", "3F", "4F"] as const;
const MATERIALS = ["CS", "SS", "AL"] as const;

export default function UploadScreen() {
  const { t } = useTranslation();
  const [proc, setProc] = useState<string>("SMAW");
  const [pos, setPos] = useState<string>("1G");
  const [mat, setMat] = useState<string>("CS");

  return (
    <Screen>
      <Card>
        <SectionTitle>{t("upload_guideTitle")}</SectionTitle>
        <Body>① {t("upload_guide1")}</Body>
        <Body>② {t("upload_guide2")}</Body>
        <Body>③ {t("upload_guide3")}</Body>
      </Card>

      <View style={{ flexDirection: "row", gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <AppButton label={t("upload_takePhoto")} icon="camera-outline" variant="secondary" disabled />
        </View>
        <View style={{ flex: 1 }}>
          <AppButton label={t("upload_pickPhoto")} icon="images-outline" variant="secondary" disabled />
        </View>
      </View>

      <SectionTitle>{t("upload_infoTitle")}</SectionTitle>
      <Label>{t("upload_process")}</Label>
      <Chips options={PROCESSES.map((v) => ({ value: v, label: v }))} value={proc} onChange={setProc} />
      <Label>{t("upload_position")}</Label>
      <Chips options={POSITIONS.map((v) => ({ value: v, label: v }))} value={pos} onChange={setPos} />
      <Label>{t("upload_material")}</Label>
      <Chips options={MATERIALS.map((v) => ({ value: v, label: v }))} value={mat} onChange={setMat} />

      <AppButton label={t("upload_analyze")} icon="sparkles-outline" disabled />
      <ComingSoon step={3} />
    </Screen>
  );
}
