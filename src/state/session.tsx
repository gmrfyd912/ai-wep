import { createContext, useContext, useState, type ReactNode } from "react";

// 1단계 임시 세션: 실제 로그인 대신 "역할 미리보기"로 고른 역할만 기억한다.
// 6단계에서 Supabase 로그인으로 교체한다.
export type Role = "student" | "teacher" | "staff" | "admin";

type Session = {
  role: Role | null;
  setRole: (role: Role | null) => void;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  return <SessionContext.Provider value={{ role, setRole }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
