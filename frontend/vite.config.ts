import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  // Content hashes also invalidate caches when releasing again at the same version
  const runtimeAssets = ['main.wasm', 'wasm_exec.js'].map(name => {
    const source = readFileSync(new URL(`./public/${name}`, import.meta.url))
    const hash = createHash('sha256').update(source).digest('hex').slice(0, 16)
    const dot = name.lastIndexOf('.')
    return { name, source, fileName: `assets/${name.slice(0, dot)}-${hash}${name.slice(dot)}` }
  })
  const runtimeUrl = (name: string) => command === 'build'
    ? `/${runtimeAssets.find(asset => asset.name === name)!.fileName}` : `/${name}`
  return {
  plugins: [vue(), {
    name: 'versioned-ssh-runtime',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: html => html.replace('src="/wasm_exec.js"', `src="${runtimeUrl('wasm_exec.js')}"`),
    },
    generateBundle() {
      for (const asset of runtimeAssets) this.emitFile({ type: 'asset', fileName: asset.fileName, source: asset.source })
    },
  }],
  define: {
    __SSH_WASM_URL__: JSON.stringify(runtimeUrl('main.wasm')),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
  resolve: {
    alias: {
      'vue-i18n': 'vue-i18n/dist/vue-i18n.esm-bundler.js'
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8022',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8022',
        ws: true,
      }
    }
  }
  }
})
