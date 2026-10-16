import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// electron-vite v5 默认约定：
// main -> src/main/index.ts, preload -> src/preload/index.ts,
// renderer -> root: src/renderer, entry: src/renderer/index.html
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main'
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload'
    }
  },
  renderer: {
    build: {
      outDir: 'out/renderer'
    }
  }
})
