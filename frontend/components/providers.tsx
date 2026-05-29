"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { USE_MOCKS } from "@/lib/config";
import { ToastProvider } from "@/components/ui/toast";
import { AuthProvider } from "@/components/auth-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  // In mock mode, start MSW before rendering anything that fetches.
  const [mocksReady, setMocksReady] = React.useState(!USE_MOCKS);
  React.useEffect(() => {
    if (!USE_MOCKS) return;
    let active = true;
    import("@/mocks/browser").then(async ({ startMocks }) => {
      await startMocks();
      if (active) setMocksReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!mocksReady) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
