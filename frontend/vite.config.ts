/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'

// The build a bug report was filed against, so a report can be tied to a commit.
function buildStamp(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
    return sha || 'unknown'
  } catch {
    return 'unknown'
  }
}

function docsDevServerPlugin(): Plugin {
  const docsDistPath = path.resolve(import.meta.dirname, '../docs-site/dist')

  return {
    name: 'docs-dev-server',
    configureServer(server) {
      server.middlewares.use('/docs', (req, res) => {
        let subPath = req.url || '/'
        subPath = subPath.split('?')[0]

        let filePath = path.join(docsDistPath, subPath)

        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html')
        }

        if (fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory()) {
          const ext = path.extname(filePath).toLowerCase()
          const mimeTypes: Record<string, string> = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'application/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.webp': 'image/webp',
            '.woff': 'font/woff',
            '.woff2': 'font/woff2',
            '.xml': 'application/xml; charset=utf-8',
          }
          res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')
          fs.createReadStream(filePath).pipe(res)
          return
        }

        const fallback404 = path.join(docsDistPath, '404.html')
        if (fs.existsSync(fallback404)) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/html; charset=utf-8')
          fs.createReadStream(fallback404).pipe(res)
          return
        }

        res.statusCode = 404
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(`
          <!DOCTYPE html>
          <html>
            <head><title>Docs Not Built</title></head>
            <body style="font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 600px; margin: 4rem auto 0; line-height: 1.6;">
              <h2 style="color: #38bdf8; margin-top: 0;">Documentation Not Built</h2>
              <p>The documentation site static files were not found in <code>docs-site/dist</code>.</p>
              <p>To view documentation while running only the frontend dev server, build the docs once:</p>
              <pre style="background: #1e293b; padding: 1rem; border-radius: 6px; color: #38bdf8; overflow-x: auto;">cd docs-site && npm run build</pre>
              <p>Or launch the Astro dev server for live-reloading docs:</p>
              <pre style="background: #1e293b; padding: 1rem; border-radius: 6px; color: #38bdf8; overflow-x: auto;">cd docs-site && npm run dev</pre>
              <p style="font-size: 0.875rem; color: #94a3b8;">When running Astro dev server, set <code>VITE_DOCS_BASE_URL=http://localhost:4321/docs/</code> in <code>frontend/.env</code>.</p>
            </body>
          </html>
        `)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), docsDevServerPlugin()],
  define: {
    __APP_BUILD__: JSON.stringify(buildStamp()),
  },
  // Bind every interface: the host shares an invite link pointing at their LAN
  // address, and players open it on their phones. A localhost-only dev server
  // makes that link unreachable.
  server: {
    host: true,
  },
  resolve: {
    alias: {
      '@ds': path.resolve(import.meta.dirname, './src/design-system'),
    },
  },
  // MapLibre asks for its worker with `{ type: 'module' }`, so the one we emit
  // for it in src/core/map/mapWorker.ts has to be an ES module too.
  worker: {
    format: 'es',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})

