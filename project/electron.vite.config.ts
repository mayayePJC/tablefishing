import { defineConfig } from 'electron-vite'

// 渲染层构建（Tauri 壳消费：tauri.conf.json 的 frontendDist = out/renderer）
// Electron 主/预加载分支已移除，仅保留 renderer 段
export default defineConfig({
  renderer: {
    build: {
      outDir: 'out/renderer',
      minify: 'esbuild'
    }
  }
})
