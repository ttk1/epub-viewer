// Minimal static file server for development (no dependencies). Serves the repository root.
// With --build, TypeScript is recompiled on page load when sources have changed
// (tsc --watch may not see host edits through Docker Desktop bind mounts).
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const port = Number(process.env.PORT ?? 8080)
const build = process.argv.includes('--build')
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.epub': 'application/epub+zip',
}

let builtVersion = 0
function buildIfChanged() {
  const sources = ['src', 'app', 'examples'].flatMap((dir) =>
    readdirSync(dir, { recursive: true }).map((file) => join(dir, file)),
  )
  const version = Math.max(...sources.map((file) => statSync(file).mtimeMs))
  if (version === builtVersion) return
  builtVersion = version
  try {
    execFileSync('node_modules/.bin/tsc', { stdio: 'inherit' })
    console.log('Built.')
  } catch {
    // tsc has already printed the errors
  }
}

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
  if (path === '/') return res.writeHead(302, { location: '/app/' }).end()
  if (path.endsWith('/')) path += 'index.html'
  if (build && path.endsWith('.html')) buildIfChanged()
  try {
    const body = await readFile(join(process.cwd(), normalize(path))) // normalize() keeps it under cwd
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(404).end('Not found')
  }
}).listen(port, () => console.log(`Serving on http://localhost:${port}/app/`))
