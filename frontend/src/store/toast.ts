import { create } from 'zustand'

export type ToastKind = 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (kind: ToastKind, message: string) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = ++seq
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Fire a toast from anywhere — including outside React (mutation callbacks). */
export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
}
