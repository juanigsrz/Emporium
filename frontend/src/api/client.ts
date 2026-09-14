import axios from 'axios'
import { useAuthStore } from '../store/auth'
import type { PaginatedResponse } from './games'

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:8000/api'

export const apiClient = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Inject Authorization token from zustand store on every request
apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Token ${token}`
  }
  return config
})

// A 401 outside the auth endpoints means the stored token is dead — sign out.
apiClient.interceptors.response.use(undefined, (error: unknown) => {
  if (
    axios.isAxiosError(error) &&
    error.response?.status === 401 &&
    !error.config?.url?.includes('/auth/')
  ) {
    useAuthStore.getState().clear()
  }
  return Promise.reject(error)
})

/** GET a DRF-paginated list and follow `next` until every result is collected. */
export async function fetchAllPages<T>(
  url: string,
  params?: Record<string, unknown>
): Promise<T[]> {
  let res = await apiClient.get<PaginatedResponse<T>>(url, {
    params: { ...params, page_size: 100 },
  })
  const out = [...res.data.results]
  while (res.data.next) {
    res = await apiClient.get<PaginatedResponse<T>>(res.data.next)
    out.push(...res.data.results)
  }
  return out
}
