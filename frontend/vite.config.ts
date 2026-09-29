/// <reference types="vitest/config" />
import { defineConfig, type Plugin, type Rolldown } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import { createHash } from 'crypto'
import { gunzipSync } from 'zlib'
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

const GLYPH_FONTSTACK = 'Noto Sans Regular';
const GLYPH_SOURCE_DIR = path.resolve(import.meta.dirname, './node_modules/smp-noto-glyphs/fixtures/glyphs');
const GLYPH_RANGE_SIZE = 256;
const GLYPH_RANGE_COUNT = 65536 / GLYPH_RANGE_SIZE;

/** The glyph PBF for one 256-codepoint range, or an empty PBF that MapLibre renders as blank space. */
function readGlyphRange(range: string): Buffer {
  try {
    return gunzipSync(fs.readFileSync(path.join(GLYPH_SOURCE_DIR, `${range}.pbf.gz`)));
  } catch {
    return Buffer.alloc(0);
  }
}

/** Serves the vendored Noto Sans SDF glyphs same-origin so map labels render offline. */
function mapGlyphsPlugin(): Plugin {
  return {
    name: 'runway-map-glyphs',
    configureServer(server) {
      server.middlewares.use('/glyphs', (req, res) => {
        const match = /^\/[^/]+\/(\d+-\d+)\.pbf$/.exec((req.url || '').split('?')[0]);
        if (!match) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'application/x-protobuf');
        res.end(readGlyphRange(match[1]));
      });
    },
    generateBundle() {
      for (let i = 0; i < GLYPH_RANGE_COUNT; i++) {
        const range = `${i * GLYPH_RANGE_SIZE}-${i * GLYPH_RANGE_SIZE + GLYPH_RANGE_SIZE - 1}`;
        this.emitFile({
          type: 'asset',
          fileName: `glyphs/${GLYPH_FONTSTACK}/${range}.pbf`,
          source: readGlyphRange(range),
        });
      }
    },
  };
}

/** Modules that make up the race and map experience, whose chunks must work offline. */
const OFFLINE_CHUNK_MODULES = /[\\/](surfaces[\\/](race|player)|core[\\/]map)[\\/]|node_modules[\\/]maplibre-gl[\\/]/;

/** Latin-subset font files and the MapLibre worker, which every race needs to paint. */
const OFFLINE_ASSETS = /(-latin-(?!ext)[^/]*\.woff2|maplibre-gl-worker[^/]*\.m?js)$/;

/** Emitted file names that the service worker precaches next to the static shell. */
function offlinePrecacheList(bundle: Rolldown.OutputBundle): string[] {
  const wanted = new Set<string>();

  const addChunk = (fileName: string) => {
    if (wanted.has(fileName)) return;
    const chunk = bundle[fileName];
    if (!chunk || chunk.type !== 'chunk') return;
    wanted.add(fileName);
    chunk.imports.forEach(addChunk);
    chunk.viteMetadata?.importedCss.forEach((css) => wanted.add(css));
  };

  for (const [fileName, output] of Object.entries(bundle)) {
    if (output.type === 'chunk') {
      const isRaceOrMap = Object.keys(output.modules).some((id) => OFFLINE_CHUNK_MODULES.test(id));
      if (output.isEntry || isRaceOrMap) addChunk(fileName);
    } else if (OFFLINE_ASSETS.test(fileName)) {
      wanted.add(fileName);
    }
  }

  return [...wanted].sort().map((fileName) => `/${fileName}`);
}

function serviceWorkerPlugin(): Plugin {
  return {
    name: 'runway-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const template = fs.readFileSync(
        path.resolve(import.meta.dirname, './sw.template.js'),
        'utf8'
      );
      const precache = offlinePrecacheList(bundle);
      const stamp = createHash('sha256')
        .update(Object.keys(bundle).sort().join('\n'))
        .digest('hex')
        .slice(0, 12);

      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replaceAll('__SW_BUILD__', stamp)
          .replace('__SW_PRECACHE__', JSON.stringify(precache)),
      });
    },
  };
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
  plugins: [react(), mapGlyphsPlugin(), serviceWorkerPlugin(), docsDevServerPlugin()],
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

