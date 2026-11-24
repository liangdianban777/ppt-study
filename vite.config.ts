import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

export default defineConfig({
  base: './',
  plugins: [react(), viteStaticCopy({
    targets: [{
      src: ['cmaps', 'iccs', 'standard_fonts', 'wasm'].map(directory => `node_modules/pdfjs-dist/${directory}`),
      dest: 'pdfjs',
      // 去掉 node_modules/pdfjs-dist，保留各资源目录。
      rename: { stripBase: 2 },
    }],
  })],
})
