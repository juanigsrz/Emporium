import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import type { ReactNode } from 'react'

interface RequireAuthProps {
  children: ReactNode
}

export default function RequireAuth({ children }: RequireAuthProps) {
  const token = useAuthStore((s) => s.token)
  const location = useLocation()

  if (!token) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
