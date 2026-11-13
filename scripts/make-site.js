// Puts together the demo site in site/ (published to GitHub Pages by .github/workflows/deploy.yml):
// the standalone app, the built JS, and two sample books. Run after `npm run build` and
// `npm run samples`. The paths are those of the repository, so the app is used as it is.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'

const INDEX = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>epub-viewer デモ</title>
    <style>
      body { max-width: 32em; margin: 3em auto; padding: 0 1em; font: 16px/1.8 system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <h1>epub-viewer デモ</h1>
    <ul>
      <li><a href="app/?url=../samples/novel.epub">縦書きの小説</a></li>
      <li><a href="app/?url=../samples/fixed.epub">漫画（固定レイアウト）</a></li>
      <li><a href="app/">手元の EPUB を開く</a>（ファイルはブラウザの中で読み込むだけで、どこにも送信しません）</li>
    </ul>
    <p><a href="https://github.com/ttk1/epub-viewer">使い方とソース</a></p>
  </body>
</html>
`

rmSync('site', { recursive: true, force: true })
mkdirSync('site/samples', { recursive: true })
cpSync('app', 'site/app', { recursive: true, filter: (path) => !path.endsWith('.ts') })
// Only what the browser loads: not the type declarations, nor the source maps.
for (const dir of ['app', 'src']) cpSync(`dist/${dir}`, `site/dist/${dir}`, { recursive: true, filter: (path) => !/\.(d\.ts|map)$/.test(path) })
// The samples that show what the viewer is for; not the one with broken and hostile content, which is for the tests.
for (const name of ['novel', 'fixed']) cpSync(`samples/${name}.epub`, `site/samples/${name}.epub`)
writeFileSync('site/index.html', INDEX)
console.log('Generated site/')
