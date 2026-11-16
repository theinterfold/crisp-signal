// SPDX-License-Identifier: LGPL-3.0-only
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
    esbuildOptions: { target: 'esnext' },
    include: ['@crisp-e3/sdk > poseidon-lite'],
    // Pre-bundling breaks the worker URLs these packages resolve relative to themselves.
    exclude: [
      '@noir-lang/noirc_abi',
      '@noir-lang/acvm_js',
      '@noir-lang/noir_js',
      '@aztec-foundation/bb.js',
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
