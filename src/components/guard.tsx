import { Redirect } from "expo-router";

import { homeOf } from "@/lib/afterLogin";
import { useSession, type Role } from "@/state/session";

/** 역할별 화면 보호: 로그인 안 했으면 로그인 화면, 다른 역할이면 내 화면으로 보낸다.
 * 화면을 그려도 되면 null 을 돌려준다. */
export function useRoleRedirect(role: Role) {
  const { user } = useSession();
  if (!user) return <Redirect href="/login" />;
  if (user.must_change_password) return <Redirect href={{ pathname: "/change-password", params: { forced: "1" } }} />;
  if (user.needs_avatar) return <Redirect href="/profile-photo" />;
  if (user.role !== role) return <Redirect href={homeOf(user.role)} />;
  return null;
}
