import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  root: '.',
  server: { port: 5173 },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
  },
  define: {
    // 打包时由 scripts/build-frontend.js 注入，用于界面显示以确认是否为当次构建
    'import.meta.env.VITE_BUILD_ID': JSON.stringify(process.env.VITE_BUILD_ID || 'dev'),
  },
})
