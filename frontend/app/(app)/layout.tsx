"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { AppShell } from "@/components/app-shell";
import { Spinner } from "@/components/ui/primitives";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { me, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !me) router.replace("/login");
  }, [loading, me, router]);

  if (loading || !me) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
