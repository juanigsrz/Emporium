"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardBody, ErrorState } from "@/components/ui/primitives";
import { FormField, Input } from "@/components/ui/field";

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ username: "", email: "", password: "", password2: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password !== form.password2) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await register(form);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed.");
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
            <Input id="username" value={form.username} onChange={set("username")} required />
          </FormField>
          <FormField label="Email" htmlFor="email">
            <Input id="email" type="email" value={form.email} onChange={set("email")} required />
          </FormField>
          <FormField label="Password" htmlFor="password">
            <Input
              id="password"
              type="password"
              value={form.password}
              autoComplete="new-password"
              onChange={set("password")}
              required
            />
          </FormField>
          <FormField label="Confirm password" htmlFor="password2">
            <Input
              id="password2"
              type="password"
              value={form.password2}
              autoComplete="new-password"
              onChange={set("password2")}
              required
            />
          </FormField>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Creating account…" : "Create account"}
          </Button>
        </form>
        <p className="text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-slate-900 hover:underline">
            Sign in
          </Link>
        </p>
      </CardBody>
    </Card>
  );
}
