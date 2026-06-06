import axios from 'axios'
import { useAuthStore } from '../store/auth'

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
  if (token) {
    config.headers.Authorization = `Token ${token}`
  }
  return config
})
