import i18n from "i18next";

/** 결함 코드(Roboflow 클래스 이름) → 화면 이름. 번역이 없으면 원래 이름 그대로.
 * (훅이 아니라서 어디서든 부를 수 있다. 언어가 바뀌면 화면의 useTranslation 이 다시 그려 준다.) */
export function defectName(type: string): string {
  const key = `defect_${type.toLowerCase()}`;
  return i18n.exists(key) ? i18n.t(key) : type;
}
