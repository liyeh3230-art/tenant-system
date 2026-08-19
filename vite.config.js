import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  base: './', // 支援 GitHub Pages 相對路徑部署
  plugins: [
    tailwindcss(),
    react(),
  ],
})
