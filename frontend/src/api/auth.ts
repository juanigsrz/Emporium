import { apiClient } from './client'
import type { AuthUser } from '../store/auth'

export interface LoginPayload {
  username: string
  password: string
}

export interface RegisterPayload {
  username: string
  email: string
  password1: string
  password2: string
}

export interface TokenResponse {
  key: string
}

export async function loginApi(payload: LoginPayload): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>('/auth/login/', payload)
  return data
}

export async function registerApi(payload: RegisterPayload): Promise<TokenResponse> {
  const { data } = await apiClient.post<TokenResponse>('/auth/registration/', payload)
  return data
}

export async function logoutApi(): Promise<void> {
  await apiClient.post('/auth/logout/')
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const { data } = await apiClient.get<AuthUser>('/auth/user/')
  return data
}
