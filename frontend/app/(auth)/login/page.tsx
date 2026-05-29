"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, ErrorState } from "@/components/ui/primitives";
import { FormField, Input } from "@/components/ui/field";
import { USE_MOCKS } from "@/lib/config";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      router.replace(params.get("next") || "/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardBody className="space-y-4">
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <ErrorState message={error} />}
          <FormField label="Username" htmlFor="username">
            <Input
              id="username"
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </FormField>
          <FormField label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              value={password}
              autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </FormField>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="text-center text-sm text-slate-500">
          No account?{" "}
          <Link href="/register" className="font-medium text-slate-900 hover:underline">
            Register
          </Link>
        </p>
        {USE_MOCKS && (
          <p className="rounded-md bg-slate-50 p-2 text-center text-xs text-slate-500">
            Mock mode — try <strong>alice</strong> / <strong>password</strong>{" "}
            (organizer).
          </p>
        )}
      </CardBody>
    </Card>
  );
}
