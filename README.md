# epub-viewer

ブラウザで EPUB を読むためのライブラリと、それを使った単体のリーダーアプリです。

- **縦書き対応**: 縦書きの本は右から左へページが進みます。横書きの本を縦書きで表示することもできます
- **ページ送り**: ← → キー、PageUp / PageDown / Space、ページの左右をクリック
- **ダークモード**などのテーマ、文字サイズの変更、目次、読書位置の保存と再開
- **組み込みやすさ**: フレームワーク非依存。イベントと位置情報（Location）で、次の話への自動遷移や本棚アプリからの再開などを実装できます
- **ランタイム依存ゼロ**: ZIP の展開もブラウザ標準の `DecompressionStream` で行います
- [nepub](https://github.com/ttk1/nepub) で作った EPUB を主な対象としていますが、一般的な EPUB 2 / 3（リフロー型）も読めます

## アプリを使う

必要なのは Docker だけです（ホストに Node.js は要りません）。

```sh
docker compose up
```

<http://localhost:8080/app/> を開き、「開く」ボタンかドラッグ＆ドロップで EPUB を読み込みます。
`http://localhost:8080/app/?url=<EPUB の URL>` で URL から直接開くこともできます。
動作確認用のサンプルは `samples/` に生成されます（例: `/app/?url=/samples/nepub.epub`）。

| 操作 | 動作 |
| --- | --- |
| ← / → | 左 / 右へページをめくる（縦書きなら ← が次のページ） |
| PageDown / Space | 次のページ |
| PageUp / Shift+Space | 前のページ |
| ページの左 1/3・右 1/3 をクリック | 左 / 右へページをめくる |
| 目次 | 選んだ章へ移動 |
| A− / A＋ | 文字サイズ |
| 自動 / 縦書き / 横書き | 表示方向（自動は本の指定に従う） |
| システムに合わせる / ライト / ダーク | テーマ（既定は OS のダークモード設定に合わせる） |

読書位置・文字サイズ・テーマはブラウザ（localStorage）に保存され、次に同じ本を開くと続きから表示されます。

## ライブラリとして組み込む

### 導入

npm には公開していません。次のどちらかで取り込んでください。

- `docker compose run --rm node npm run build` で生成される `dist/src/`（ES Modules + 型定義、依存なし）をプロジェクトにコピーする
- TypeScript をそのまま扱えるバンドラー（Vite など）なら `src/` をコピーして直接 import する

### 最小の例

```html
<div id="viewer" style="width: 100%; height: 100vh"></div>
<script type="module">
  import { EpubViewer, openBook, themes } from './epub-viewer/index.js'

  const viewer = new EpubViewer(document.getElementById('viewer'), { theme: themes.dark })
  const book = await openBook('/books/sample.epub') // URL / File / Blob / ArrayBuffer
  await viewer.open(book)

  viewer.addEventListener('relocate', (e) => {
    console.log(`${e.detail.page + 1} / ${e.detail.pages} ページ`, viewer.location)
  })
</script>
```

コンテナ要素には必ず大きさ（幅と高さ）を与えてください。ビューアはその中いっぱいに表示されます。

### 例: 最後のページで次の話へ進む

1 話ごとに EPUB が分かれている場合、最後のページで「次へ」を押すと `bookend` イベントが、
最初のページで「前へ」を押すと `bookstart` イベントが発生します。

```js
const episodes = ['ep1.epub', 'ep2.epub', 'ep3.epub']
let current = 0
let book

async function show(index, atEnd = false) {
  const next = await openBook(episodes[index])
  book?.destroy()
  book = next
  current = index
  // atEnd: 前の話に戻るときは最後のページから表示する（progress: 1 = 最後のページ）
  await viewer.open(book, atEnd ? { index: book.sections.length - 1, progress: 1 } : undefined)
}

viewer.addEventListener('bookend', () => current + 1 < episodes.length && show(current + 1))
viewer.addEventListener('bookstart', () => current > 0 && show(current - 1, true))
show(0)
```

動く例は `examples/series.html`（<http://localhost:8080/examples/series.html>）にあります。

### 例: 本棚アプリで読書位置を保存・再開する

`viewer.location` は `{ index, progress }`（何番目のセクションの、どこまで読んだか）です。
文字サイズや画面サイズが変わってもおおよそ同じ位置を指すので、そのまま保存して再開に使えます。

```js
viewer.addEventListener('relocate', () => {
  saveToServer(bookId, viewer.location) // 例: { index: 3, progress: 0.42 }
})

// 再開
await viewer.open(book, await loadFromServer(bookId))
```

本全体の進捗（0〜1）は `relocate` イベントの `e.detail.fraction` で取れます（進捗バーの表示などに）。

### 例: 章へのリンクから開く

`book.toc` の `href`（`"src/text/3.xhtml"` や `"OEBPS/ch2.xhtml#sec1"` のようなアーカイブ内パス）は
そのまま `open()` / `goTo()` に渡せます。

```js
await viewer.open(book, book.toc[2].href)
await viewer.goTo(book.toc[5].href)
```

### 例: 表示のカスタマイズ

```js
// 書籍の文書が読み込まれるたび（レイアウト前）に呼ばれる。独自のスタイルなどを追加できる
viewer.addEventListener('sectionload', (e) => {
  const style = e.detail.doc.createElement('style')
  style.textContent = 'body { font-family: "Noto Serif JP", serif; }'
  e.detail.doc.head.append(style)
})

// 外部リンクのクリック。preventDefault() すると新しいタブで開く既定の動作を止められる
viewer.addEventListener('link', (e) => {
  e.preventDefault()
  if (confirm(`${e.detail.href} を開きますか？`)) window.open(e.detail.href)
})

// キー操作をアプリ側で制御したい場合
const viewer = new EpubViewer(el, { keyboard: false })
myKeymap.on('j', () => viewer.next())
```

## API

### `openBook(source): Promise<Book>`

EPUB を読み込みます。`source` は URL（文字列 / `URL`）、`File` / `Blob`、`ArrayBuffer` / `Uint8Array`。

### `Book`

| メンバー | 説明 |
| --- | --- |
| `metadata` | `{ identifier, title, creator, language }`。nepub 製 EPUB は `identifier` が空 |
| `sections` | 読む順のセクション一覧 `{ href, linear, size }[]`。`linear: false` はページ送りで飛ばされる |
| `toc` | 目次 `{ label, href, children }[]`（EPUB 3 の nav、なければ EPUB 2 の NCX） |
| `loadCover()` | 表紙画像の `Blob`（なければ `undefined`）。本棚のサムネイルなどに |
| `getUrl(path)` | アーカイブ内ファイルの blob: URL |
| `destroy()` | 作成した blob: URL を解放する。本を閉じるときに呼ぶ |

### `new EpubViewer(container, options?)`

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `theme` | `themes.light` | `{ background, color, link }`。`themes.light` / `themes.dark` / `themes.sepia` または独自の色 |
| `fontScale` | `1` | 文字サイズの倍率 |
| `writingMode` | `'auto'` | `'auto'`（本の指定に従う）/ `'vertical'` / `'horizontal'` |
| `margin` | `32` | ページ余白（px） |
| `keyboard` | `true` | ホストのウィンドウで ← → PageUp PageDown Space を受け付ける。入力欄にフォーカスがあるときは反応しない |

| メソッド・プロパティ | 説明 |
| --- | --- |
| `open(book, location?)` | 本を表示する。`location` は `Location` か目次の `href`。省略時は先頭 |
| `goTo(location)` | 指定位置へ移動 |
| `next()` / `prev()` | 次 / 前のページ（セクションの境界もまたぐ） |
| `goLeft()` / `goRight()` | 左 / 右へめくる（縦書きなら `goLeft()` が次のページ） |
| `setOptions(options)` | オプションを変更し、現在位置を保ったまま再レイアウト |
| `location` | 現在位置 `{ index, progress }`（未表示なら `undefined`） |
| `options` | 現在のオプション |
| `book` | 表示中の `Book` |
| `destroy()` | ビューアを破棄する（`Book` の破棄は別途 `book.destroy()`） |

| イベント | `detail` | 発生するとき |
| --- | --- | --- |
| `relocate` | `{ index, progress, page, pages, fraction }` | 表示ページが変わった |
| `bookend` | – | 最後のページで `next()` した |
| `bookstart` | – | 最初のページで `prev()` した |
| `sectionload` | `{ index, doc }` | セクションの文書を読み込んだ（レイアウト前） |
| `link` | `{ href }` | 外部リンクがクリックされた（キャンセル可能） |

TypeScript では `addEventListener` の `e.detail` に型が付きます。

## 対応範囲と制限

- 対応: EPUB 2 / 3 のリフロー型、縦書き（`vertical-rl`）と横書き、ルビ、縦中横、目次（nav / NCX）、
  画像・CSS・フォントなど書籍内のリソース、`-epub-` 接頭辞付きの古い CSS プロパティ
- 未対応: 固定レイアウト（漫画など）、見開き表示、右から左へ書く横書き（アラビア語など）、
  DRM 付きの EPUB、ZIP64（4GB 超）、書籍内のスクリプト（安全のため常に無効）
- ブラウザ: 最新の Chrome / Edge / Firefox / Safari（テストは Chromium / Firefox / WebKit で実施）

## セキュリティ

- 書籍の各ページは sandbox 付きの iframe に表示し、Content-Security-Policy（`script-src 'none'`）を
  挿入して書籍内のスクリプトを実行させません。書籍の外部へのリソース読み込みも行いません。
- ランタイム依存はありません。開発用の依存（TypeScript、Playwright）はバージョンと
  ハッシュを固定し、公開から 7 日未満の版はインストールしない設定にしています（`.npmrc`）。

## 開発

```sh
docker compose up                              # 開発サーバー（ページを再読み込みすると再ビルド）
docker compose run --rm node npm test          # 型チェック + Chromium / Firefox / WebKit でテスト
docker compose run --rm node npm run build     # dist/ を生成
```

| パス | 内容 |
| --- | --- |
| `src/` | ライブラリ本体（`zip.ts` → `book.ts` → `viewer.ts`、公開 API は `index.ts`） |
| `app/` | 単体アプリ |
| `examples/` | 組み込み例 |
| `scripts/` | 開発サーバー、サンプル EPUB 生成 |
| `test/` | Playwright テスト |

開発時の注意点やチェックリストは [CLAUDE.md](CLAUDE.md) にまとめています。
