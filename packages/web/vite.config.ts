import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 45677,
    proxy: { '/api': { target: process.env['API_URL'] ?? 'http://127.0.0.1:45678', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
})
