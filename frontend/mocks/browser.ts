// MSW browser worker bootstrap. Started by Providers when NEXT_PUBLIC_USE_MOCKS=1.

import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);

let started = false;

export async function startMocks() {
  if (started) return;
  started = true;
  await worker.start({
    onUnhandledRequest: "bypass",
    quiet: true,
  });
}
