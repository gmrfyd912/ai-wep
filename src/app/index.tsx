import { Redirect } from "expo-router";

import { isFirstLaunch } from "@/i18n";

/** 시작 화면: 처음 실행이면 언어 선택, 아니면 로그인으로 보낸다. */
export default function Index() {
  return <Redirect href={isFirstLaunch() ? "/language?first=1" : "/login"} />;
}
