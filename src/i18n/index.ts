import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en";
import es from "./locales/es";
import fil from "./locales/fil";
import id from "./locales/id";
import ko from "./locales/ko";
import th from "./locales/th";
import uz from "./locales/uz";
import vi from "./locales/vi";

export type LangCode = "ko" | "en" | "vi" | "th" | "fil" | "uz" | "id" | "es";

// 언어 목록: 각 언어는 그 나라 말로 표시한다(언어를 몰라도 고를 수 있게).
export const LANGUAGES: { code: LangCode; nativeName: string }[] = [
  { code: "ko", nativeName: "한국어" },
  { code: "en", nativeName: "English" },
  { code: "vi", nativeName: "Tiếng Việt" },
  { code: "th", nativeName: "ภาษาไทย" },
  { code: "fil", nativeName: "Filipino" },
  { code: "uz", nativeName: "O'zbekcha" },
  { code: "id", nativeName: "Bahasa Indonesia" },
  { code: "es", nativeName: "Español" },
];

const STORAGE_KEY = "aiwep.language";
const SUPPORTED = LANGUAGES.map((l) => l.code);

function deviceLanguage(): LangCode {
  const code = getLocales()[0]?.languageCode ?? "en";
  if (code === "tl") return "fil"; // 일부 기기는 필리핀어를 tl(타갈로그)로 보고함
  return (SUPPORTED as string[]).includes(code) ? (code as LangCode) : "en";
}

i18n.use(initReactI18next).init({
  resources: {
    ko: { translation: ko },
    en: { translation: en },
    vi: { translation: vi },
    th: { translation: th },
    fil: { translation: fil },
    uz: { translation: uz },
    id: { translation: id },
    es: { translation: es },
  },
  lng: deviceLanguage(),
  fallbackLng: "en",
  keySeparator: false,
  interpolation: { escapeValue: false },
});

let savedLanguage: LangCode | null = null;

/** 앱 시작 시 저장된 언어를 불러온다. 처음 실행이면 null. */
export async function loadSavedLanguage(): Promise<LangCode | null> {
  const saved = await AsyncStorage.getItem(STORAGE_KEY);
  if (saved && (SUPPORTED as string[]).includes(saved)) {
    await i18n.changeLanguage(saved);
    savedLanguage = saved as LangCode;
  }
  return savedLanguage;
}

/** 처음 실행인지(아직 언어를 고른 적이 없는지) */
export const isFirstLaunch = () => savedLanguage === null;

export async function setLanguage(code: LangCode) {
  await AsyncStorage.setItem(STORAGE_KEY, code);
  savedLanguage = code;
  await i18n.changeLanguage(code);
}

export default i18n;
