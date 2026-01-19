
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // Vercel 시스템 환경 변수를 클라이언트 코드에서 사용할 수 있도록 주입합니다.
    'process.env.API_KEY': JSON.stringify(process.env.API_KEY),
    'process.env.API_KEY2': JSON.stringify(process.env.API_KEY2),
    'process.env.API_KEY3': JSON.stringify(process.env.API_KEY3),
    'process.env.API_KEY4': JSON.stringify(process.env.API_KEY4),
    'process.env.API_KEY5': JSON.stringify(process.env.API_KEY5),
    'process.env.API_KEY6': JSON.stringify(process.env.API_KEY6),
    'process.env.API_KEY7': JSON.stringify(process.env.API_KEY7),
    'process.env.API_KEY8': JSON.stringify(process.env.API_KEY8)
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'https://chat-gem.vercel.app',
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
