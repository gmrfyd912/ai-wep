import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState } from "react-native";

import { getMe, loadToken, saveToken, setUnauthorizedHandler, type Me, type Role } from "@/lib/api";

export type { Role };

// 로그인 상태. 토큰과 마지막으로 받은 내 정보를 휴대폰에 저장해 두고,
// 앱을 다시 열면 서버가 잠들어 있어도 바로 내 화면을 보여 준 뒤 뒤에서 새로 확인한다.
const USER_KEY = "aiwep.user";
const LAST_ID_KEY = "aiwep.lastLoginId";
const RELOGIN_KEY = "aiwep.reloginVersion";

/**
 * 다시 로그인해야 적용되는 앱 업데이트를 내보낼 때 이 숫자를 1 올린다.
 * 휴대폰에 저장된 숫자와 다르면 앱을 열 때 한 번 로그아웃시킨다.
 */
export const RELOGIN_VERSION = 1;

/** 로그인 화면에 띄울 안내 (회원 정보가 바뀌었거나 업데이트로 다시 로그인해야 할 때) */
export type SignOutNotice = "changed" | "updated";

type Session = {
  ready: boolean;
  user: Me | null;
  role: Role | null;
  signIn: (token: string, user: Me) => Promise<void>;
  setUser: (user: Me) => void;
  signOut: () => Promise<void>;
  /** 로그인 화면 안내 (한 번 보여 주고 지운다) */
  notice: SignOutNotice | null;
  clearNotice: () => void;
  /** 마지막으로 로그인한 아이디 (로그인 화면에 미리 채움) */
  lastLoginId: string;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUserState] = useState<Me | null>(null);
  const [notice, setNotice] = useState<SignOutNotice | null>(null);
  const [lastLoginId, setLastLoginId] = useState("");
  const clearNotice = useCallback(() => setNotice(null), []);

  const setUser = useCallback((u: Me) => {
    setUserState(u);
    AsyncStorage.setItem(USER_KEY, JSON.stringify(u)).catch(() => null);
  }, []);

  const signIn = useCallback(
    async (token: string, u: Me) => {
      await saveToken(token);
      setUser(u);
      setNotice(null);
      setLastLoginId(u.login_id);
      AsyncStorage.multiSet([
        [LAST_ID_KEY, u.login_id],
        [RELOGIN_KEY, String(RELOGIN_VERSION)],
      ]).catch(() => null);
    },
    [setUser],
  );

  const signOut = useCallback(async () => {
    await saveToken(null);
    await AsyncStorage.removeItem(USER_KEY).catch(() => null);
    setUserState(null);
  }, []);

  // 서버가 로그인을 끊었으면(역할·반·권한 변경, 비밀번호 초기화, 사용 중지 등) 안내와 함께 로그인 화면으로
  const kickedOut = useCallback(
    (why: SignOutNotice) => {
      setNotice(why);
      signOut().finally(() => {
        if (router.canDismiss()) router.dismissAll();
        router.replace("/login");
      });
    },
    [signOut],
  );
  useEffect(() => {
    setUnauthorizedHandler(() => kickedOut("changed"));
    return () => setUnauthorizedHandler(null);
  }, [kickedOut]);

  // 다른 앱을 보다가 돌아오면 내 정보를 다시 확인 (끊겼으면 위 핸들러가 로그인 화면으로)
  const userRef = useRef<Me | null>(null);
  userRef.current = user;
  const lastCheck = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !userRef.current) return;
      if (Date.now() - lastCheck.current < 30_000) return;
      lastCheck.current = Date.now();
      getMe()
        .then(setUser)
        .catch(() => null);
    });
    return () => sub.remove();
  }, [setUser]);

  useEffect(() => {
    (async () => {
      let token = await loadToken().catch(() => null);
      const [[, lastId], [, relogin]] = await AsyncStorage.multiGet([LAST_ID_KEY, RELOGIN_KEY]).catch(
        () => [[LAST_ID_KEY, null], [RELOGIN_KEY, null]] as [string, string | null][],
      );
      if (lastId) setLastLoginId(lastId);
      if (token && relogin !== String(RELOGIN_VERSION)) {
        // 다시 로그인해야 하는 업데이트: 한 번 로그아웃
        const saved = await AsyncStorage.getItem(USER_KEY).catch(() => null);
        if (!lastId && saved) {
          try {
            setLastLoginId((JSON.parse(saved) as Me).login_id);
          } catch {
            // 무시
          }
        }
        await saveToken(null);
        await AsyncStorage.removeItem(USER_KEY).catch(() => null);
        setNotice("updated");
        token = null;
      }
      let cached = false;
      if (token) {
        const saved = await AsyncStorage.getItem(USER_KEY).catch(() => null);
        if (saved) {
          try {
            setUserState(JSON.parse(saved) as Me);
            cached = true;
          } catch {
            // 저장된 값이 깨졌으면 서버에서 다시 받는다
          }
        }
        if (!cached) await getMe().then(setUser).catch(() => null);
      }
      setReady(true);
      if (token && cached) {
        // 뒤에서 최신 정보로 갱신 (401 이면 위 핸들러가 로그인 화면으로 보낸다)
        getMe()
          .then(setUser)
          .catch(() => null);
      }
    })();
  }, [setUser]);

  return (
    <SessionContext.Provider value={{ ready, user, role: user?.role ?? null, signIn, setUser, signOut, notice, clearNotice, lastLoginId }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
