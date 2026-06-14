import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// base '/static/' on build so asset URLs resolve under Django/WhiteNoise
// (STATIC_URL). Dev server keeps '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/static/' : '/',
  plugins: [react()],
  server: {
    port: 5173,
  },
}))
