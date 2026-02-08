import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  // 在 Tauri 的 file:// 协议下使用相对路径，避免生产环境白屏
  base: process.env.TAURI_PLATFORM ? './' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // Tauri 期望 Vite 开发服务器运行在这个端口
  server: {
    port: 1420,
    strictPort: true,
  },
  // Tauri 使用这个环境变量
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Tauri 使用 Chromium on Windows 和 WebKit on macOS/Linux
    target: process.env.TAURI_PLATFORM == 'windows' ? 'chrome105' : 'safari13',
    // 不要在生产环境中生成 sourcemap
    sourcemap: false,
  }
});
