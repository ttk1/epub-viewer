# epub-viewer

ブラウザで EPUB を読むためのライブラリと、それを使った単体のリーダーアプリです。

- **縦書き対応**: 縦書きの本は右から左へページが進みます。横書きの本を縦書きで表示することもできます
- **ページ送り**: ← → ↑ ↓ キー、PageUp / PageDown / Space、ページの左右をクリック。リモコン操作でもページが飛ばないようチャタリング対策済み
- **ダークモード**などのテーマ、明朝 / ゴシックの切り替え、文字サイズ・表示幅の変更、目次、読書位置の保存と再開
- **組み込みやすさ**: フレームワーク非依存。ツールバー付きの画面ごと（`EpubReader`）でも、表示部分だけ（`EpubViewer`）でも組み込めます。イベントと位置情報（Location）で、次の話への自動遷移や本棚アプリからの再開などを実装できます
- **ランタイム依存ゼロ**: ZIP の展開もブラウザ標準の `DecompressionStream` で行います
- [nepub](https://github.com/ttk1/nepub) で作った EPUB を主な対象としていますが、一般的な EPUB 2 / 3（リフロー型）も読めます

## アプリを使う

必要なのは Docker だけです（ホストに Node.js は要りません）。

```sh
docker compose up
```

<http://localhost:8080/app/> を開き、「開く」ボタンかドラッグ＆ドロップで EPUB を読み込みます。`http://localhost:8080/app/?url=<EPUB の URL>` で URL から直接開くこともできます。動作確認用のサンプルは `samples/` に生成されます（例: `/app/?url=/samples/nepub.epub`）。

| 操作 | 動作 |
| --- | --- |
| ← / → | 左 / 右へページをめくる（縦書きなら ← が次のページ） |
| ↓ / PageDown / Space | 次のページ |
| ↑ / PageUp / Shift+Space | 前のページ |
| ページの左 1/3・右 1/3 をクリック | 左 / 右へページをめくる |
| 目次 | 選んだ章へ移動 |
| A− / A＋ | 文字サイズ（既定 45px、1 段階ごとに 1.2 倍） |
| 幅: 全幅〜600px | 表示幅。ページを画面中央の指定幅に収める（左右の余白をクリックしてもページをめくれる） |
| 自動 / 縦書き / 横書き | 表示方向（自動は本の指定に従う） |
| システム / ライト / ダーク | テーマ（既定の「システム」は OS のダークモード設定に合わせる） |
| 明朝 / ゴシック / 本の指定 | フォント（既定は明朝。「本の指定」は書籍の CSS のフォントを使う） |

キーは押しっぱなしにしても 1 ページだけ進みます。また、ごく短い間隔（100ms 以内）の連続入力はチャタリングとみなして無視するので、リモコンでも 1 回押すごとに 1 ページずつめくれます。

読書位置と各設定（文字サイズ・フォント・表示幅・表示方向・テーマ）はブラウザ（localStorage）に保存され、次に同じ本を開くと続きから表示されます。読書位置は本の識別子（`dc:identifier`）ごと、識別子がない本（nepub 製など）は URL やファイル名ごとに保存されます。

## ライブラリとして組み込む

### 導入

npm には公開していません。バージョンタグの付いたリビジョンを各自ビルドして使う想定です。次のどちらかで取り込んでください。

- `docker compose run --rm node npm run build` で生成される `dist/src/`（ES Modules + 型定義、依存なし）をプロジェクトにコピーする
- TypeScript をそのまま扱えるバンドラー（Vite など）なら `src/` をコピーして直接 import する

組み込み方は 2 通りあります。

- **`EpubReader`**: 単体アプリと同じ画面（ツールバー + 本文）をそのまま使う。設定と読書位置の保存も込み。ツールバーには独自のボタンを追加できる
- **`EpubViewer`**: 本文の表示部分だけを使い、画面は自分で作る

### 画面ごと組み込む（EpubReader）

```html
<div id="reader" style="height: 100vh"></div>
<script type="module">
  import { EpubReader } from './epub-viewer/index.js'

  const reader = new EpubReader(document.getElementById('reader'), {
    storageKey: 'my-app', // localStorage のキーの接頭辞（設定と読書位置）
    settings: { theme: 'dark' }, // 初期設定（ユーザーが変えるまで使われる）
  })
  // ツールバーに独自のボタンを追加
  reader.toolbar.prepend(Object.assign(document.createElement('a'), { href: '/', textContent: 'トップ' }))

  await reader.open('/books/sample.epub')
</script>
```

`reader.viewer` は内部の `EpubViewer` です。イベント（`bookend` など）やページ移動には、こちらを使います。

### 表示部分だけ組み込む（EpubViewer）

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

1 話ごとに EPUB が分かれている場合、最後のページで「次へ」を押すと `bookend` イベントが、最初のページで「前へ」を押すと `bookstart` イベントが発生します。これらはキーを押すたびに発生するので、次の話を読み込んでいる間は無視してください。

```js
const reader = new EpubReader(document.getElementById('reader'))
let current = 1
let loading = false

async function show(episode, atEnd = false) {
  if (loading || episode < 1) return
  loading = true
  try {
    await reader.open(`/books/novel_${episode}.epub`, {
      // 1 話ごとの EPUB はタイトルが共通なことが多いので、読書位置のキーは話ごとに指定する
      key: `novel:${episode}`,
      // 前の話に戻るときは最後のページから表示する（progress: 1 = 最後のページ）
      location: atEnd ? { index: -1, progress: 1 } : undefined,
    })
    current = episode
  } catch {
    // 次の話がない（最新話）など
  } finally {
    loading = false
  }
}

reader.viewer.addEventListener('bookend', () => show(current + 1))
reader.viewer.addEventListener('bookstart', () => show(current - 1, true))
show(1)
```

`EpubViewer` だけで同じことをする例が `examples/series.html`（<http://localhost:8080/examples/series.html>）にあります。

### 例: 本棚アプリで読書位置を保存・再開する

`viewer.location` は `{ index, progress }`（何番目のセクションの、どこまで読んだか）です。文字サイズや画面サイズが変わってもおおよそ同じ位置を指すので、そのまま保存して再開に使えます。

```js
viewer.addEventListener('relocate', () => {
  saveToServer(bookId, viewer.location) // 例: { index: 3, progress: 0.42 }
})

// 再開
await viewer.open(book, await loadFromServer(bookId))
```

本全体の進捗（0〜1）は `relocate` イベントの `e.detail.fraction` で取れます（進捗バーの表示などに）。`index` に負の数を指定すると末尾から数えます（`{ index: -1, progress: 1 }` = 最後のページ）。

`EpubReader` を使う場合は読書位置の保存・再開が組み込まれています。保存のキーは本の識別子（`dc:identifier`）、なければ URL かファイル名です。1 話ごとの EPUB のように識別子やタイトルが共通の本は、`reader.open(source, { key })` で話ごとのキーを指定してください。

### 例: 章へのリンクから開く

`book.toc` の `href`（`"src/text/3.xhtml"` や `"OEBPS/ch2.xhtml#sec1"` のようなアーカイブ内パス）はそのまま `open()` / `goTo()` に渡せます。

```js
await viewer.open(book, book.toc[2].href)
await viewer.goTo(book.toc[5].href)
```

### 例: 表示のカスタマイズ

```js
// フォントは明朝 / ゴシックの既定の指定のほか、任意の font-family も指定できる
viewer.setOptions({ fontFamily: fonts.gothic, fontSize: 24 })
viewer.setOptions({ fontFamily: '"Noto Serif JP", serif' })

// 書籍の文書が読み込まれるたび（レイアウト前）に呼ばれる。独自のスタイルなどを追加できる
viewer.addEventListener('sectionload', (e) => {
  const style = e.detail.doc.createElement('style')
  style.textContent = 'p { text-indent: 1em; }'
  e.detail.doc.head.append(style)
})

// 外部リンクのクリック。preventDefault() すると新しいタブで開く既定の動作を止められる
viewer.addEventListener('link', (e) => {
  e.preventDefault()
  if (confirm(`${e.detail.href} を開きますか？`)) window.open(e.detail.href)
})

// キー・クリックでのページ送りが失敗した（壊れたセクションなど）ときの通知
viewer.addEventListener('error', (e) => showMessage(`表示できませんでした: ${e.detail.error}`))

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

### `new EpubReader(root, options?)`

ツールバー（目次・進捗・文字サイズ・フォント・表示幅・表示方向・テーマ）と本文をまとめた画面です。`root` には高さを与えてください。

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `storageKey` | `'epub-viewer'` | localStorage のキーの接頭辞。設定は `<storageKey>:settings`、読書位置は `<storageKey>:position:<キー>` に保存される。`''` で保存しない |
| `settings` | – | 初期設定 `{ theme, font, fontSize, maxWidth, writingMode }`（ユーザーが変えるまで使われる）。既定はシステムのテーマ・明朝・45px・全幅・自動 |
| `viewer` | – | 内部の `EpubViewer` に渡すオプション（`keyboard`・`cooldown` など）。見た目のオプションは設定から決まる |

| メソッド・プロパティ | 説明 |
| --- | --- |
| `open(source, { key?, location? })` | 本を開いて表示し、`Book` を返す。`location` を省略すると保存された位置（なければ先頭）から。`key` は読書位置の保存キー |
| `toolbar` | ツールバーの要素。独自のボタンやリンクを追加できる（`button` / `select` / `a` / `label` にはツールバーの見た目が付く） |
| `viewer` | 内部の `EpubViewer`。イベントやページ移動に使う |
| `book` | 表示中の `Book` |
| `settings` | 現在の設定 |
| `destroy()` | 画面を破棄する（表示中の `Book` も破棄する） |

### `new EpubViewer(container, options?)`

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `theme` | `themes.light` | `{ background, color, link }`。`themes.light` / `themes.dark` / `themes.sepia` または独自の色 |
| `fontFamily` | `''` | 本のフォントを上書きする CSS の font-family。`fonts.mincho`（明朝）/ `fonts.gothic`（ゴシック）は各 OS の和文フォントをまとめた指定。`''` は本の指定のまま |
| `fontSize` | `16` | 基準の文字サイズ（px）。本が em や % で指定した文字サイズはこれに比例する |
| `writingMode` | `'auto'` | `'auto'`（本の指定に従う）/ `'vertical'` / `'horizontal'` |
| `margin` | `32` | ページ余白（px） |
| `maxWidth` | `0` | ページの最大幅（px）。コンテナの中央に表示し、左右の余白はテーマの背景色になる（余白のクリックでもページをめくれる）。`0` は全幅 |
| `keyboard` | `true` | ホストのウィンドウで ← → ↑ ↓ PageUp PageDown Space を受け付ける。入力欄にフォーカスがあるときは反応しない。スクロールするページに埋め込む場合、これらのキーはページのスクロールに使われなくなるので、必要なら `false` にして自前でキーを割り当てる |
| `cooldown` | `100` | ページ送りのキー・クリックを、直前の操作からこのミリ秒以内なら無視する（リモコンのチャタリング対策）。キーは押しっぱなしにしても 1 回押すごとに 1 ページだけ進む |

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
| `link` | `{ href }` | 外部リンク（`http:` / `https:` / `mailto:`）がクリックされた（キャンセル可能）。それ以外の URL（`javascript:` など）は開かない |
| `error` | `{ error }` | キー・クリックでのページ送りに失敗した（壊れたセクションなど）。表示は元のページのまま。コードから呼んだ `next()` などは代わりに Promise が reject される |

TypeScript では `addEventListener` の `e.detail` に型が付きます。

## 対応範囲と制限

- 対応: EPUB 2 / 3 のリフロー型、縦書き（`vertical-rl`）と横書き、ルビ、縦中横、目次（nav / NCX）、画像・CSS・フォントなど書籍内のリソース、`-epub-` 接頭辞付きの古い CSS プロパティ
- 未対応: マウスホイール・トラックパッド・スワイプでのページ送り、固定レイアウト（漫画など）、見開き表示、右から左へ書く横書き（アラビア語など）、DRM 付きの EPUB、ZIP64（4GB 超）、書籍内のスクリプトと、`<iframe>` / `<object>` / `<embed>` で埋め込まれた文書（安全のため常に無効）
- ブラウザ: 最新の Chrome / Edge / Firefox / Safari（テストは Chromium / Firefox / WebKit で実施）

## セキュリティ

- 書籍の各ページは sandbox 付きの iframe に表示し、Content-Security-Policy を挿入して、書籍内のスクリプト・埋め込み文書（`<iframe>` など）・外部へのリソース読み込みを禁止しています。ページを別の URL へ移動させる `<meta http-equiv="refresh">` も取り除きます。
- 書籍内のリンクは、本の中への移動か `http:` / `https:` / `mailto:` の外部リンクだけを扱い、`javascript:` などの URL は開きません。
- ランタイム依存はありません。開発用の依存（TypeScript、Playwright）はバージョンとハッシュを固定し、公開から 7 日未満の版はインストールしない設定にしています（`.npmrc`）。
- 組み込み先のページに Content-Security-Policy ヘッダーを付ける場合は、書籍の表示に blob: URL を使うため、少なくとも `frame-src blob:`、`img-src blob: data:`、`style-src blob: 'unsafe-inline'`、`font-src blob: data:`、`media-src blob: data:` を許可してください（`default-src` で許可していれば不要）。`EpubReader` はツールバーのスタイルを `<style>` 要素で追加するので、`style-src 'unsafe-inline'` も必要です。

## 開発

```sh
docker compose up                              # 開発サーバー（ページを再読み込みすると再ビルド）
docker compose run --rm node npm test          # 型チェック + Chromium / Firefox / WebKit でテスト
docker compose run --rm node npm run build     # dist/ を生成
```

| パス | 内容 |
| --- | --- |
| `src/` | ライブラリ本体（`zip.ts` → `book.ts` → `viewer.ts` → `reader.ts`、公開 API は `index.ts`） |
| `app/` | 単体アプリ |
| `examples/` | 組み込み例 |
| `scripts/` | 開発サーバー、サンプル EPUB 生成 |
| `test/` | Playwright テスト |

開発時の注意点やチェックリストは [CLAUDE.md](CLAUDE.md) にまとめています。
