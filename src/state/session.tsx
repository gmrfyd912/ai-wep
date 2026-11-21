import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { getMe, loadToken, saveToken, setUnauthorizedHandler, type Me, type Role } from "@/lib/api";

export type { Role };

// 로그인 상태. 토큰과 마지막으로 받은 내 정보를 휴대폰에 저장해 두고,
// 앱을 다시 열면 서버가 잠들어 있어도 바로 내 화면을 보여 준 뒤 뒤에서 새로 확인한다.
const USER_KEY = "aiwep.user";

type Session = {
  ready: boolean;
  user: Me | null;
  role: Role | null;
  signIn: (token: string, user: Me) => Promise<void>;
  setUser: (user: Me) => void;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUserState] = useState<Me | null>(null);

  const setUser = useCallback((u: Me) => {
    setUserState(u);
    AsyncStorage.setItem(USER_KEY, JSON.stringify(u)).catch(() => null);
  }, []);

  const signIn = useCallback(
    async (token: string, u: Me) => {
      await saveToken(token);
      setUser(u);
    },
    [setUser],
  );

  const signOut = useCallback(async () => {
    await saveToken(null);
    await AsyncStorage.removeItem(USER_KEY).catch(() => null);
    setUserState(null);
  }, []);

  // 다른 곳에서 로그아웃됐거나(비밀번호 변경 등) 계정이 없어지면 로그인 화면으로
  useEffect(() => {
    setUnauthorizedHandler(() => {
      signOut().finally(() => {
        if (router.canDismiss()) router.dismissAll();
        router.replace("/login");
      });
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  useEffect(() => {
    (async () => {
      const token = await loadToken().catch(() => null);
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
    <SessionContext.Provider value={{ ready, user, role: user?.role ?? null, signIn, setUser, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
