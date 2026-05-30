"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { me as meApi } from "@/lib/api/resources";
import type { UserProfile } from "@/lib/api/types";

interface AuthContextValue {
  me: UserProfile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  password2: string;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

async function authPost(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message =
      data?.detail ||
      data?.non_field_errors?.join(" ") ||
      "Authentication failed.";
    throw new Error(message);
  }
  return data as { profile: UserProfile | null };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = React.useState<UserProfile | null>(null);
  const [loading, setLoading] = React.useState(true);
  const queryClient = useQueryClient();

  const refresh = React.useCallback(async () => {
    try {
      const profile = await meApi.get();
      setMe(profile);
    } catch {
      setMe(null);
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const profile = await meApi.get();
        if (active) setMe(profile);
      } catch {
        if (active) setMe(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const login = React.useCallback(
    async (username: string, password: string) => {
      const { profile } = await authPost("/api/auth/login", {
        username,
        password,
      });
      setMe(profile ?? (await meApi.get()));
      queryClient.clear();
    },
    [queryClient],
  );

  const register = React.useCallback(
    async (payload: RegisterPayload) => {
      const { profile } = await authPost("/api/auth/register", payload);
      setMe(profile ?? (await meApi.get()));
      queryClient.clear();
    },
    [queryClient],
  );

  const logout = React.useCallback(async () => {
    await authPost("/api/auth/logout").catch(() => undefined);
    setMe(null);
    queryClient.clear();
  }, [queryClient]);

  return (
    <AuthContext.Provider
      value={{ me, loading, login, register, logout, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}
