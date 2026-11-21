import { Redirect } from "expo-router";

import { isFirstLaunch } from "@/i18n";
import { homeOf } from "@/lib/afterLogin";
import { useSession } from "@/state/session";

/** 시작 화면: 처음 실행이면 언어 선택, 로그인돼 있으면 내 화면, 아니면 로그인. */
export default function Index() {
  const { user } = useSession();
  if (isFirstLaunch()) return <Redirect href="/language?first=1" />;
  if (!user) return <Redirect href="/login" />;
  if (user.must_change_password) return <Redirect href={{ pathname: "/change-password", params: { forced: "1" } }} />;
  return <Redirect href={homeOf(user.role)} />;
}
