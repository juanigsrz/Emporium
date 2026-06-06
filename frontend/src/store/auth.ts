import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  pk: number
  username: string
  email: string
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  setSession: (token: string, user: AuthUser) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      clear: () => set({ token: null, user: null }),
    }),
    {
      name: 'mathtrade-auth',
    }
  )
)
