// SPDX-License-Identifier: LGPL-3.0-only
import { readFile } from 'node:fs/promises'
import type { Plugin as EsbuildPlugin } from 'esbuild'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// bb.js proves with SharedArrayBuffer, which browsers only expose to cross-origin isolated pages.
// Production hosting must send the same two headers.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

/**
 * The PXE's SQLite store starts its worker from `new URL('./worker.js', import.meta.url)`. Pre-bundling moves that code away from
 * the worker file, so under `vite dev` point the URL at the file in place, which Vite then serves and bundles as a worker.
 * (`vite build` resolves the original URL itself.)
 */
function sqliteWorkerUrl(): EsbuildPlugin {
  return {
    name: 'sqlite-worker-url',
    setup(build) {
      build.onLoad({ filter: /@aztec-labs\/kv-store\/dest\/sqlite-opfs\/store\.js$/ }, async ({ path }) => {
        const source = await readFile(path, 'utf8')
        const worker = path.replace(/store\.js$/, 'worker.js')
        return { contents: source.replace("new URL('./worker.js', import.meta.url)", `new URL('/@fs${worker}', import.meta.url)`), loader: 'js' }
      })
    },
  }
}

/**
 * Runs `api/pin.ts` under `vite dev`, as Vercel runs it in production, with server-only variables
 * (PINATA_JWT) read from .env without the VITE_ prefix, so they stay out of the bundle.
 */
function apiFunctions(): Plugin {
  return {
    name: 'crisp-signal-api',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '')
      process.env.PINATA_JWT ??= env.PINATA_JWT
      server.middlewares.use('/api/pin', async (req, res) => {
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const { POST } = await server.ssrLoadModule('/api/pin.ts')
          if (req.method !== 'POST') {
            res.statusCode = 405
            return res.end()
          }
          const response: Response = await POST(
            new Request('http://localhost/api/pin', { method: 'POST', body: Buffer.concat(chunks) }),
          )
          res.statusCode = response.status
          res.setHeader('Content-Type', response.headers.get('Content-Type') ?? 'application/json')
          res.end(await response.text())
        } catch (error) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(error) }))
        }
      })
    },
  }
}

export default defineConfig({
  define: { global: 'globalThis' },
  optimizeDeps: {
    esbuildOptions: { target: 'esnext', plugins: [sqliteWorkerUrl()] },
    include: ['@crisp-e3/sdk > poseidon-lite'],
    // Pre-bundling breaks the worker URLs these packages resolve relative to themselves.
    exclude: [
      '@noir-lang/noirc_abi',
      '@noir-lang/acvm_js',
      '@noir-lang/noir_js',
      '@aztec-foundation/bb.js',
      '@aztec-foundation/noir-acvm_js',
      '@aztec-foundation/noir-noirc_abi',
      '@aztec/bb.js',
      '@crisp-e3/sdk',
      '@crisp-e3/sdk/insecure-64',
      '@crisp-e3/sdk/secure-8192',
    ],
  },
  worker: { format: 'es' },
  // esnext keeps top-level await native; the SDK's wasm loaders rely on it.
  build: { target: 'esnext' },
  plugins: [react(), nodePolyfills({ include: ['buffer'] }), apiFunctions()],
  server: { port: 5180, headers: isolation },
  preview: { port: 5180, headers: isolation },
})
