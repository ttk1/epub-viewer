# epub-viewer

ブラウザで EPUB を表示するためのライブラリです。小説などの文章の本（縦書き・横書き）と、漫画などの固定レイアウトの本を、ページをめくって読めます。

リーダーアプリや連載サイトの**土台**として組み込むことを想定しています。表示とページ送りという核の部分だけを確実に担い、それ以外（画面のデザイン、次の話への移動、しおり、ページスライダーなど）は、イベントと API を使って組み込む側で自由に作れるようにしています。

- **小説などの文章の本**: 縦書きの本は右から左へ、横書きの本は左から右へページが進みます。縦書きはルビ・縦中横・傍点に対応し、横書きは幅に余裕があれば 2 段組みで表示します。縦書きと横書きは、表示するときに切り替えることもできます
- **漫画などの固定レイアウト**: ページを画面に合わせて拡大縮小し、横長の画面では見開き（2 ページ並び）で表示します
- **ページ送り**: キーボード、クリック・タップ、スワイプ、マウスホイール・トラックパッド。リモコン操作でもページが飛ばないチャタリング対策つき
- **組み込みやすさ**: フレームワーク非依存で、ランタイム依存はありません（ZIP の展開もブラウザ標準の機能で行います）。ビルド後の大きさは、最小化なしの状態（コメントは除く）を gzip して約 22 KB です
- **安全性**: 書籍の中のスクリプトは動かしません。外部への通信もさせません

| 知りたいこと | 読むところ |
| --- | --- |
| どんなものか、すぐ試したい | [3 つの層](#3-つの層)、[試す（単体アプリ）](#試す単体アプリ) |
| 自分のサイトやアプリに組み込みたい | [組み込む](#組み込む)、[組み込むときの注意](#組み込むときの注意) |
| 次の話への移動、しおり、スライダーなどを足したい | [拡張する](#拡張する) |
| オプション・メソッド・イベントの一覧 | [API](#api) |
| 何ができて、何ができないか | [対応範囲と制限](#対応範囲と制限) |
| 信頼できない本を表示しても大丈夫か | [セキュリティ](#セキュリティ) |

## 3 つの層

必要な層だけを使えます。上の層は下の層の上に作ってあるので、下の層の API はいつでも使えます。

| 層 | 役割 | こんなときに |
| --- | --- | --- |
| `openBook()` / `Book` | EPUB を読み込み、メタデータ・目次・本文とリソースを取り出す | 本棚の一覧や表紙の表示だけしたい |
| `EpubViewer` | 本をページ単位で表示し、ページ送りを受け付ける。画面の部品は持たない | 画面は自分でデザインしたい（連載サイトなど） |
| `EpubReader` | `EpubViewer` にツールバー（目次・進捗のスライダー・表示設定）と、設定・読書位置の保存を足した画面 | すぐ使える画面がほしい |

`app/` には、`EpubReader` にファイルを開く機能を足しただけの単体アプリがあります。

## 試す（単体アプリ）

ブラウザで [デモ](https://ttk1.github.io/epub-viewer/) を開くと、サンプルの本と、手元の EPUB を試せます。

手元で動かす場合に必要なのは Docker だけです（ホストに Node.js は要りません）。

```sh
docker compose up
```

<http://localhost:8080/app/> を開き、「開く」ボタンかドラッグ＆ドロップで EPUB を読み込みます。`http://localhost:8080/app/?url=<EPUB の URL>` で URL から直接開くこともできます。動作確認用のサンプルは `samples/` に生成されます（縦書きの小説: `/app/?url=/samples/nepub.epub`、漫画: `/app/?url=/samples/fixed.epub`）。

| 操作 | 動作 |
| --- | --- |
| ← / → | 左 / 右へページをめくる（縦書きで表示しているときと、右開きの本では ← が次のページ。縦書きの本の中の横書きのページ（表紙や奥付）も同じ） |
| ↓ / PageDown / Space | 次のページ |
| ↑ / PageUp / Shift+Space | 前のページ |
| ページの左 1/3・右 1/3 をクリック（タップ） | 左 / 右へページをめくる |
| 左右にスワイプ | 指で引いた方向へページをめくる（右へスワイプすると左のページ） |
| マウスホイール・トラックパッド | 下へで次のページ、上へで前のページ（横方向は ← / → と同じ）。1 回の操作で 1 ページ |
| ツールバーの下の線のつまみ | ドラッグして離すと、本の中のその位置へ移動。動かしている間、ページ（漫画など）や全体の % が連動する。線は読み終えた分だけ塗られ、右開きの本では右から進む |
| 目次 | 選んだ章へ移動。いま読んでいる章が強調される（項目が 1 つ以下の本では表示されない） |
| Aa | 表示設定を開く。本の種類に合う項目だけが表示される |

表示設定の項目は次のとおりです。

| 項目 | 対象 | 内容 |
| --- | --- | --- |
| 文字サイズ | 小説など | A− / A＋。既定 45px、1 段階ごとに 1.2 倍 |
| フォント | 小説など | 明朝（既定）/ ゴシック / 本の指定 |
| 行間 | 小説など | 本の指定（既定）/ 狭い / 標準 / 広い / とても広い。選んだ値は本の指定より優先する |
| 表示幅 | 小説など | 全幅（既定）〜 600px。ページを画面中央の指定幅に収める |
| 余白 | 小説など | 狭い / 標準（既定）/ 広い / とても広い。ページの周りの余白（16〜96px）。2 段組みでは段の間も広がる |
| 表示方向 | 小説など | 自動（本の指定）/ 縦書き / 横書き |
| 見開き | 漫画と、横書きで表示している本 | 自動 / する / しない。漫画は 2 ページ並べ、横書きの本は 2 段組みにする。自動は画面に余裕があるときだけ。縦書きで表示している間は出ない（1 ページが幅いっぱいなので） |
| 開き方向 | 漫画など | 本の指定 / 右開き / 左開き。右開きの指定が抜けている漫画に |
| テーマ | すべて | 自動（OS のダークモード設定に合わせる）/ ライト / セピア / ダーク |

そのほかの動作:

- 文字サイズや表示方向、ウィンドウの大きさを変えても、読んでいた文章のあるページがそのまま表示されます。
- キーは押しっぱなしにしても 1 ページだけ進みます。ごく短い間隔（100ms 以内）の連続入力はチャタリングとみなして無視するので、リモコンでも 1 回押すごとに 1 ページずつめくれます。
- ツールバーはキーボードでも操作できます（Tab で移動、Enter / Space で決定。目次は ↑ ↓ で項目を移動、Esc で閉じる）。メニューの外をクリックしても閉じます。メニューが開いている間は、キーで後ろのページはめくれません。
- 読書位置と設定はブラウザ（localStorage）に保存され、次に同じ本を開くと続きから表示されます。読書位置は本の識別子（`dc:identifier`）ごと、識別子がない本は URL やファイル名ごとに保存されます。

## 組み込む

npm には公開していません。バージョンタグの付いたリビジョンを各自ビルドして使う想定です。次のどちらかで取り込んでください。

- `docker compose run --rm node npm run build` で生成される `dist/src/`（ES Modules + 型定義、依存なし）をプロジェクトにコピーする
- TypeScript をそのまま扱えるバンドラー（Vite など）なら `src/` をコピーして直接 import する（import を `.ts` 拡張子で書いているので、型チェックには `allowImportingTsExtensions` が要る）

### 表示部分だけ使う（EpubViewer）

画面を自分で作る場合はこちらです。コンテナ要素には必ず大きさ（幅と高さ）を与えてください。ビューアはその中いっぱいに表示されます。コンテナが非表示（`display: none`）の間に開いた本や移動した先は、表示されたときにその位置で表示されます。表示中にコンテナを DOM の別の場所へ付け替えないでください（iframe が再読み込みされ、表示が消えます。場所を変えるときはビューアを作り直します）。

```html
<div id="viewer" style="width: 100%; height: 100vh"></div>
<script type="module">
  import { EpubViewer, openBook, themes } from './epub-viewer/index.js'

  const viewer = new EpubViewer(document.getElementById('viewer'), { theme: themes.dark })
  // イベントは open() の前に登録する（最初のページの表示でも relocate が発生する）
  viewer.addEventListener('relocate', (e) => {
    console.log(`全体の ${Math.round(e.detail.fraction * 100)}%`, viewer.location)
  })

  const book = await openBook('/books/sample.epub') // URL / File / Blob / ArrayBuffer
  await viewer.open(book)
</script>
```

`EpubViewer` は `Book` を破棄しません。閉じるときは `book.destroy()` を呼んでください。別の本に切り替えるときは、新しい本の `open()` が成功してから前の本を破棄します（`open()` が失敗したときは前の本を表示し続けるため）。`EpubReader` は自分で破棄します。

### 画面ごと使う（EpubReader）

```html
<div id="reader" style="height: 100vh"></div>
<script type="module">
  import { EpubReader } from './epub-viewer/index.js'

  const reader = new EpubReader(document.getElementById('reader'), {
    storageKey: 'my-app', // 設定と読書位置の保存キーの接頭辞
    settings: { theme: 'dark' }, // 初期設定（ユーザーが変えるまで使われる）
  })
  // ツールバーに独自のリンクを追加
  reader.toolbar.prepend(Object.assign(document.createElement('a'), { href: '/', textContent: 'トップ' }))

  await reader.open('/books/sample.epub')
</script>
```

`reader.viewer` は内部の `EpubViewer` です。イベントやページ移動には、こちらを使います。

画面全体に表示してページ自体はスクロールさせない場合は、`body { margin: 0; overscroll-behavior: none; }` を指定しておくと、スマートフォンで縦に指を動かしたときにブラウザの「引っ張って更新」が働きません。高さに `100dvh` を使うときは、古いブラウザ向けに `height: 100vh; height: 100dvh;` と併記してください。

### 組み込むときの注意

つまずきやすい点をまとめておきます。

- **コンテナには大きさが要る**: `EpubViewer` のコンテナには幅と高さを、`EpubReader` の `root` には高さを、CSS で与えてください。大きさが 0 だと何も表示されません。
- **イベントは `open()` の前に登録する**: 最初のページの表示でも `relocate` が発生します。
- **表示中のコンテナを DOM の別の場所へ付け替えない**: iframe が再読み込みされ、表示が消えます。場所を変えるときは、ビューアを作り直してください。
- **前の本の `destroy()` は、次の本の `open()` が成功してから**（`EpubViewer` の場合）: `open()` が失敗したときは、前の本を表示し続けるためです。`EpubReader` は自分で行います。
- **自前のキー操作は、本文の文書でも受ける**: 本文をクリックするとフォーカスが本文（iframe）に移り、ホストのウィンドウの `keydown` は届かなくなります。[表示や操作を変える](#表示や操作を変える) の例のように、`sectionload` で渡される文書にもリスナーを付けてください（ビューア自身のキー操作は、この対応を済ませています）。
- **ページに Content-Security-Policy を付けている場合**: 書籍の表示に blob: URL を使うので、許可が要ります。[組み込む側で気を付けること](#組み込む側で気を付けること) を見てください。
- **信頼できない本を扱う場合**: 表紙（`loadCover()`）が SVG のときの扱いと、受け付けるファイルの大きさの制限について、[セキュリティ](#セキュリティ) を見てください。

## 拡張する

このライブラリが持つのは核の機能だけです。その先は、次の仕組みを使って組み込む側で作ります。

| 作りたいもの | 使うもの |
| --- | --- |
| 次の話・前の話への移動 | `bookend` / `bookstart` イベント |
| しおり、続きから読む、サーバーへの保存 | `viewer.location` と `relocate` イベント、`open()` / `goTo()` |
| ページスライダー、進捗バー | `relocate` の `fraction`（と、向きを決める `rtl`）、`goTo({ fraction })` |
| 「3–4 / 200 ページ」のような表示 | `relocate` の `index` / `indices` / `page` / `pages` |
| タップでメニューやツールバーを出し入れ | `tap` イベント |
| 独自の操作方法（キー割り当て、タップの範囲） | `keyboard` / `click` / `wheel` / `swipe` オプションを切り、`next()` などを自分で呼ぶ |
| 独自の表示設定の画面 | `viewer.setOptions()`、`EpubReader` なら `reader.setSettings()` |
| ページへの独自のスタイルや処理（注釈、ハイライトなど） | `sectionload` イベントで渡される文書（`Document`） |
| 外部リンクの扱い（確認を出す、アプリ内で開く） | `link` イベント |
| 設定や読書位置の保存先を変える（`EpubReader`） | `storage` オプション |
| ツールバーへのボタンの追加（`EpubReader`） | `reader.toolbar` |
| 本棚、表紙の一覧 | `openBook()`、`book.metadata`、`book.loadCover()` |

以下は代表的な作り方です。

### 最後のページで次の話へ進む

1 話ごとに EPUB が分かれている場合、最後のページで「次へ」を押すと `bookend` イベントが、最初のページで「前へ」を押すと `bookstart` イベントが発生します。これらはキーを押すたびに発生するので、次の話を読み込んでいる間は無視してください。

```js
const reader = new EpubReader(document.getElementById('reader'))
let current = 1
let loading = false

// location を省略すると、保存された位置（なければ先頭）から開く
async function show(episode, location) {
  if (loading || episode < 1) return
  loading = true
  try {
    // 読書位置のキーは、URL が変わっても同じ話を指すものを自分で決めておくと確実
    await reader.open(`/books/novel_${episode}.epub`, { key: `novel:${episode}`, location })
    current = episode
  } catch {
    // 次の話がない（最新話）など
  } finally {
    loading = false
  }
}

// 次の話は先頭から、前の話は最後のページから表示する（index: -1 = 最後のセクション、progress: 1 = 最後のページ）
reader.viewer.addEventListener('bookend', () => show(current + 1, { index: 0, progress: 0 }))
reader.viewer.addEventListener('bookstart', () => show(current - 1, { index: -1, progress: 1 }))
show(1) // 続きから
```

`EpubViewer` だけで同じことをする例が `examples/series.html`（<http://localhost:8080/examples/series.html>）にあります。

### 読書位置を保存して、続きから開く

`viewer.location` は `{ index, progress }`（何番目のセクションの、どこまで読んだか）です。文字サイズや画面サイズが変わってもおおよそ同じ位置を指すので、そのまま保存して再開に使えます。`index` に負の数を指定すると末尾から数えます（`{ index: -1, progress: 1 }` = 最後のページ）。

```js
viewer.addEventListener('relocate', () => {
  saveToServer(bookId, viewer.location) // 例: { index: 3, progress: 0.42 }
})

// 再開
await viewer.open(book, await loadFromServer(bookId))
```

`EpubReader` は読書位置と設定を自分で保存します。保存先は `storage` オプションで差し替えられます（`getItem` / `setItem` を持つものなら何でもよく、既定は localStorage）。

```js
// サーバーに保存してある内容を先に読み込んでおき、書き込みはサーバーにも送る
const saved = await (await fetch('/api/reader-state')).json() // { "my-app:settings": "...", ... }
const storage = {
  getItem: (key) => saved[key] ?? null,
  setItem: (key, value) => {
    saved[key] = value
    navigator.sendBeacon('/api/reader-state', JSON.stringify({ key, value }))
  },
}
const reader = new EpubReader(el, { storage, storageKey: 'my-app' })
```

読書位置のキーは、本の識別子（`dc:identifier`）、なければ URL かファイル名、それもなければタイトルです。次の場合は `reader.open(source, { key })` でキーを指定してください: 識別子が複数の本で共通している（1 話ごとの EPUB など）、URL が毎回変わる（署名付き URL など）、`Blob` や `ArrayBuffer` のように名前のないものから開く。

### ページスライダー

`relocate` イベントの `fraction` は本全体の中での位置（0〜1）で、`goTo({ fraction })` はその位置へ移動します。

```js
const slider = document.querySelector('input[type=range]') // min="0" max="1" step="any"
viewer.addEventListener('relocate', (e) => (slider.value = e.detail.fraction))
slider.addEventListener('change', () => viewer.goTo({ fraction: Number(slider.value) }))
```

漫画で「3–4 / 200」のようにページ番号を出すには、表示中のセクション（固定レイアウトでは 1 セクションが 1 ページ）を使います。

```js
viewer.addEventListener('relocate', (e) => {
  label.textContent = `${e.detail.indices.map((i) => i + 1).join('–')} / ${viewer.book.sections.length}`
})
```

### タップでツールバーを出し入れする

ページの中央のクリック・タップは `tap` イベントになります。

```js
reader.viewer.addEventListener('tap', () => {
  reader.toolbar.hidden = !reader.toolbar.hidden // 隠した分だけページが広がる
})
```

### 章へのリンクから開く

`book.toc` の `href`（`"src/text/3.xhtml"` や `"OEBPS/ch2.xhtml#sec1"` のようなアーカイブ内パス）はそのまま `open()` / `goTo()` に渡せます。リンクのない見出しだけの項目は `href` が空です。

```js
await viewer.open(book, book.toc[2].href)
await viewer.goTo(book.toc[5].href)
```

### 表示や操作を変える

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

// ユーザーの操作での移動が失敗した（壊れたセクションなど）ときの通知
viewer.addEventListener('error', (e) => showMessage(`表示できませんでした: ${e.detail.error}`))
```

操作をアプリ側で決めたい場合は、キーやクリックでのページ送りを切って、自分で呼びます。

```js
const viewer = new EpubViewer(el, { keyboard: false, click: false })
const onKey = (e) => {
  if (e.key === 'j') viewer.next()
}
window.addEventListener('keydown', onKey)
// 本文をクリックするとフォーカスが本文（iframe）に移り、キーはホストのウィンドウに届かなくなるので、本文の側でも受ける
viewer.addEventListener('sectionload', (e) => e.detail.doc.defaultView.addEventListener('keydown', onKey))
viewer.addEventListener('tap', (e) => (e.detail.x < 0.5 ? viewer.goLeft() : viewer.goRight()))
```

## API

### `openBook(source): Promise<Book>`

EPUB を読み込みます。`source` は URL（文字列 / `URL`）、`File` / `Blob`、`ArrayBuffer` / `Uint8Array`。

### `Book`

| メンバー | 説明 |
| --- | --- |
| `metadata` | `{ identifier, title, creator, language, layout, direction }`。`identifier` は本によっては空。`layout` は `'reflowable'` か `'pre-paginated'`（固定レイアウト）、`direction` はページの進む向き（`'rtl'` = 右開き / `'ltr'`） |
| `sections` | 読む順のセクション一覧 `{ href, linear, size, spread? }[]`。`linear: false` はページ送りで飛ばされる。固定レイアウトでは 1 セクションが 1 ページで、`spread` は見開きでの位置（`'left'` / `'right'` / `'center'`、本に指定があるときだけ） |
| `toc` | 目次 `{ label, href, children }[]`（EPUB 3 の nav、なければ EPUB 2 の NCX）。目次のファイルが読めない本では空 |
| `loadCover()` | 表紙画像の `Blob`（なければ `undefined`）を `Promise` で返す。本棚のサムネイルなどに。返すのは画像だけ（ビットマップ画像か SVG）。SVG の表紙（`blob.type` が `image/svg+xml`）を表示するときは、[セキュリティ](#セキュリティ) の注意を読むこと |
| `getUrl(path)` | アーカイブ内ファイルの URL を `Promise` で返す。画像・スタイル・フォントとして使うためのもの。スクリプトを含みうる種類（SVG など）は `data:` URL、それ以外は blob: URL になる |
| `destroy()` | 作成した blob: URL を解放する。本を閉じるときに呼ぶ。以後 `getUrl()` は失敗する |

### `new EpubViewer(container, options?)`

見た目のオプション:

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `theme` | `themes.light` | `{ background, color, link }`。`themes.light` / `themes.dark` / `themes.sepia` または独自の色。本文の文字はこの色で表示する。ただし、本が背景色を付けた部分（白抜きの見出し、網掛けのコードなど）は、文字も本の色のまま表示する。背景が暗いテーマでは、本が黒で引いた罫線を文字色で、外字画像を白黒反転して表示する |
| `fontFamily` | `''` | 本のフォントを上書きする CSS の font-family。`fonts.mincho`（明朝）/ `fonts.gothic`（ゴシック）は各 OS の和文フォントをまとめた指定。`''` は本の指定のまま。等幅フォントの部分（コードなど）は上書きしない |
| `fontSize` | `16` | 基準の文字サイズ（px）。本が em や % で指定した文字サイズはこれに比例する |
| `lineHeight` | `0` | 本文の行間（文字サイズに対する倍率）。本の指定より優先する。`0` は本の指定のまま（指定がなければ 1.6） |
| `writingMode` | `'auto'` | `'auto'`（本の指定に従う）/ `'vertical'` / `'horizontal'` |
| `margin` | `32` | ページ余白（px） |
| `maxWidth` | `0` | ページの最大幅（px）。コンテナの中央に表示し、左右の余白はテーマの背景色になる（余白のクリックでもページをめくれる）。`0` は全幅 |
| `spread` | `'auto'` | 見開き。固定レイアウトの本は 2 ページを並べ、横書きの本は 2 段組みにする。`'auto'`（余裕があるときだけ: 固定レイアウトは横長のコンテナ、横書きは 1 段が 20 文字分以上になる幅）/ `'always'` / `'never'`。縦書きの本は 1 ページが幅いっぱいなので変わらない |
| `direction` | `'auto'` | 固定レイアウトの本でページが進む向き。`'rtl'`（右開き。漫画など）/ `'ltr'`（左開き）/ `'auto'`（本の指定に従う）。左右のキー・クリック・スワイプの向きと、見開きの並び順が変わる |

固定レイアウトの本では、`theme` の背景色（ページの外側の色）と `spread`・`direction` だけが働きます（ページの見た目は本の側で決まっているため）。

ページ送りのオプション（切ると、その入力は何もしなくなるので、自分で扱える）:

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `keyboard` | `true` | ホストのウィンドウで ← → ↑ ↓ PageUp PageDown Space を受け付ける。入力欄にフォーカスがあるときと、先に `preventDefault()` されたキーには反応しない。ウィンドウ全体で受けるので、1 ページに複数のビューアを置くと、キーに反応するのは最初に作ったものだけになる（処理したキーに `preventDefault()` するため）。ほかのビューアは `keyboard: false` にして、必要なら自分で `next()` などを呼ぶ。スクロールするページに埋め込む場合、これらのキーはページのスクロールに使われなくなる |
| `click` | `true` | ページの左 1/3・右 1/3（と、幅を制限したときの左右の余白）のクリック・タップでページをめくる。ページの周りの余白のクリックは、すぐ隣のページの端のクリックとして扱う。`false` にすると、リンク以外のクリックはすべて `tap` イベントになる。書籍内のリンクはどちらでも働く |
| `wheel` | `true` | ビューアの上でのマウスホイール・トラックパッドでページをめくる（1 回の操作で 1 ページ）。ビューア上ではページのスクロールに使われなくなる。Ctrl＋ホイール（拡大縮小）は妨げない |
| `swipe` | `true` | タッチ画面での左右のスワイプでページをめくる。ブラウザのタッチ操作（ページのスクロール、ピンチでの拡大、拡大中の移動）は妨げず、拡大表示中・文字の選択中・2 本指・縦方向の動きではめくらない |
| `cooldown` | `100` | これらの入力を、直前のページ送りからこのミリ秒以内なら無視する（リモコンのチャタリング対策） |

| メソッド・プロパティ | 説明 |
| --- | --- |
| `open(book, target?)` | 本を表示する。`target` は `goTo()` と同じ。省略時と、その位置が本にないときは先頭。前に表示していた `Book` は破棄しない。表示できるセクションが 1 つもない本（`book.sections` が空）や、最初に表示するセクションを読めない本は reject され、前の本を表示し続ける（ページ送りもそのまま使える） |
| `goTo(target)` | 移動する。`target` は `BookLocation`（`{ index, progress }`）、目次の `href`、または `{ fraction }`（本全体の中での位置 0〜1）。その位置が本にないときは何もしない。続けて呼ぶと、後から呼んだほうが表示される |
| `next()` / `prev()` | 次 / 前のページ（セクションの境界もまたぐ）。前の移動（ページの読み込み）が終わるまでと、本を開く前は何もしない |
| `goLeft()` / `goRight()` | 左 / 右へめくる（`relocate` の `rtl` が `true` のとき、`goLeft()` が次のページ） |
| `setOptions(options)` | オプションを変更して再レイアウトする。ページ先頭にあった文章のあるページを表示し続ける |
| `location` | 現在位置 `{ index, progress }`（未表示なら `undefined`） |
| `options` | 現在のオプション |
| `book` | 表示中の `Book` |
| `destroy()` | ビューアを破棄する（`Book` の破棄は別途 `book.destroy()`）。表示の途中だった `open()` などの `Promise` は、何も表示せずに解決する |

| イベント | `detail` | 発生するとき |
| --- | --- | --- |
| `relocate` | `{ index, progress, page, pages, fraction, rtl, indices }` | 表示ページが変わった、または再レイアウトされた（オプションの変更やコンテナの大きさの変化でページ数が変わる）。`page` / `pages` はセクション内のページ番号（0 始まり）とページ数、`fraction` は本全体の中での位置（最後のページで 1。読む順に入らない `linear: false` のセクションは数えない）、`rtl` はページが左へ進むかどうか（`goLeft()` が次のページ）。縦書きで表示しているとき、右開きの固定レイアウト、右開きの本の横書きのページ（縦書きの本の表紙や奥付。`writingMode: 'horizontal'` で横書きにしたときを除く）で `true`、`indices` は表示中のセクション（見開きなら 2 つ。`index` はその先頭） |
| `bookend` | – | 最後のページで `next()` した |
| `bookstart` | – | 最初のページで `prev()` した |
| `sectionload` | `{ index, doc }` | セクションの文書を読み込んだ（レイアウト前）。同じセクションでも、表示し直すたびに発生する |
| `tap` | `{ x }` | リンクでもページ送りでもないクリック・タップ（ページの中央 1/3。`click: false` のときはページ全体）。`x` はページ上の横位置（左端 0 〜 右端 1） |
| `link` | `{ href }` | 外部リンク（`http:` / `https:` / `mailto:`）がクリックされた（キャンセル可能）。`href` は、ブラウザが解釈したとおりに整えた URL（実際に開く行き先）。それ以外の URL（`javascript:` など）や、URL として読めないものは開かない |
| `error` | `{ error }` | ユーザーの操作（ページ送り、書籍内のリンク、`EpubReader` の目次）での移動に失敗した（壊れたセクションなど）。表示は元のページのまま。コードから呼んだ `next()` などは代わりに Promise が reject される。書籍がページを別の場所へ移動させようとしたときにも発生する（そのページは表示しない） |

`open()` / `goTo()` / `next()` / `prev()` / `goLeft()` / `goRight()` は、表示が終わると解決する `Promise` を返します。TypeScript では `addEventListener` の `e.detail` に型が付きます。

### `new EpubReader(root, options?)`

ツールバー（目次・進捗とその位置へ移動するスライダー・表示設定メニュー）と本文をまとめた画面です。ツールバーはテーマの色に合わせて表示されます。`root` には高さを与えてください。`root` の中身は置き換えられ、`epub-reader` クラスが付きます。

ツールバーの文言は日本語で、テーマは下の 4 種類、フォントは 3 種類です。行間・表示幅・余白の選択肢と、文字サイズの範囲・刻みは、`choices` / `fontSizeSteps` オプションでサイトに合わせて変えられます。それ以外を変えたい場合や、画面の構成そのものを変えたい場合は、`EpubViewer` の上に自分の画面を作ってください（`EpubReader` は `EpubViewer` の公開 API だけで作られています。[src/reader.ts](src/reader.ts) は 1 ファイルで完結しているので、自分の画面を作るときの実例・出発点として使えます）。

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `storage` | localStorage | 設定と読書位置の保存先。`getItem(key)` / `setItem(key, value)` を持つもの。`null` で保存しない |
| `storageKey` | `'epub-viewer'` | 保存キーの接頭辞。設定は `<storageKey>:settings`、読書位置は `<storageKey>:position:<キー>` に保存される |
| `settings` | – | 初期設定 `{ theme, font, fontSize, lineHeight, maxWidth, margin, writingMode, spread, direction }`。`theme` は `'system'` / `'light'` / `'sepia'` / `'dark'`、`font` は `'mincho'` / `'gothic'` / `'book'`、それ以外は `EpubViewer` の同名のオプションと同じ。既定は OS に合わせたテーマ・明朝・45px・それ以外は `EpubViewer` の既定値。保存されるのはユーザーが変えた項目だけで、それ以外はここで指定した値が使われ続ける |
| `viewer` | – | 内部の `EpubViewer` に渡すオプション（`keyboard`・`click`・`wheel`・`swipe`・`cooldown`）。見た目のオプション（余白の `margin` を含む）は設定から決まる |
| `choices` | – | 設定メニューに並べる選択肢。`{ lineHeight, maxWidth, margin }` のうち変えたいものに、`[値, ラベル]` の配列を渡す（例: `{ margin: [[0, 'なし'], [32, '標準'], [128, '広い']] }`）。値の意味は `EpubViewer` の同名のオプションと同じ。渡さなかった設定は既定の選択肢のまま。空の配列を渡した設定は、メニューに出ない（幅をサイト側で決めている場合など） |
| `fontSizeSteps` | `{ min: 12, max: 120, step: 1.2 }` | 文字サイズのボタン（A− / A＋）で変えられる範囲（px）と、1 回で何倍にするか。変えたいものだけ渡せばよい。範囲はボタンにだけ効く: `settings` や `setSettings()`、保存された設定の値は範囲の外でもそのまま使われ、次にボタンを押したときに範囲の中へ入る |

| メソッド・プロパティ | 説明 |
| --- | --- |
| `open(source, { key?, location? })` | 本を開いて表示し、`Book` を返す。`location` は `goTo()` の `target` と同じで、省略すると保存された位置（なければ先頭）から。`key` は読書位置の保存キー。読み込みが終わる前にもう一度呼ぶと後の呼び出しが優先され、どちらの呼び出しも後の本を返す。開けなかったとき（EPUB でない、表示できるページがない、など）は reject され、前の本を表示し続ける |
| `setSettings(changes)` | 設定を変える（例: `reader.setSettings({ theme: 'sepia' })`）。ツールバーで変えたときと同じく表示に反映され、保存される |
| `settings` | 現在の設定 |
| `toolbar` | ツールバーの要素。独自のボタンやリンクを追加できる（直下に置いた `button` / `select` / `a` / `label` にはツールバーの見た目が、`span` には文字用の余白が付く。作品名の要素は `.title`）。`hidden` にすると隠れ、その分ページが広がる |
| `viewer` | 内部の `EpubViewer`。イベントやページ移動に使う |
| `book` | 表示中の `Book` |
| `destroy()` | 画面を破棄する（表示中の `Book` も破棄する） |

### 型

TypeScript 用に次の型も export しています: `BookSource`（`openBook()` に渡せるもの）、`Metadata`、`Section`、`TocItem`、`Theme`、`ViewerOptions`、`BookLocation`、`BookTarget`（`goTo()` に渡せるもの）、`RelocateDetail`、`EpubViewerEventMap`、`ReaderOptions`、`ReaderChoices`、`FontSizeSteps`、`ReaderSettings`、`OpenOptions`。

## 対応範囲と制限

- 対応: EPUB 2 / 3 のリフロー型と固定レイアウト（`rendition:layout` が `pre-paginated` の本）、見開き表示、縦書き（`vertical-rl`）と横書き、ルビ、縦中横、目次（nav / NCX）、画像・CSS・フォントなど書籍内のリソース、`-epub-` / `-webkit-` 接頭辞だけで書かれた縦書き・縦中横などの CSS プロパティ
- 未対応: スワイプ中に指に追従するページのアニメーション、右から左へ書く横書き（アラビア語など）、DRM 付きの EPUB、ZIP64（4GB 超）、書籍内のスクリプト、`<iframe>` / `<object>` / `<embed>` で埋め込まれた文書、本文（spine）に置かれた SVG など XHTML / HTML 以外の文書、XSLT（`<?xml-stylesheet?>`）（スクリプト以降は安全のため常に無効）
- 固定レイアウトの見開きは、本が各ページの左右を指定していればそれに従い、指定がなければ最初のページ（表紙）を単独にして残りを 2 ページずつ並べます。ページの大きさは viewport の指定（なければページ内の SVG か画像の大きさ）から決めます。横長のページ（1 枚で見開きになっている絵）も 1 ページとして扱うので、見開きにすると小さくなります
- ページを読み込む間も前のページを表示したままにし、読み込みが終わってから差し替えます（めくるたびに画面が白くなりません）。次のページのファイルは先に展開しておきます
- ファイルの途中での改ページの指定（`page-break-before: always` など）は効かず、続けて表示します（章ごとにファイルを分けた本は、ファイルの境目で改ページされます）
- 1 ページに収まらない行は折り返して表示します（改行できない「……」の連続や `<pre>` の長い行など）。ただし 1 ページより長いルビ、ページより幅の広い表、書籍の CSS で幅を固定した要素は折り返せず、次のページにはみ出します
- タッチ画面では、ページ端を続けてタップしたときに拡大されないよう、ダブルタップでの拡大だけを無効にしています（ピンチでの拡大は使えます）
- ブラウザのページ内検索（Ctrl+F）は、表示中のセクション（章）の中で使えます。見つかった場所からそのままページ送りを続けられます
- ブラウザ: 最新の Chrome / Edge / Firefox / Safari（テストは Chromium / Firefox / WebKit で実施）。少し古い版でも動きます（Chromium 104、Firefox 113、WebKit 16.4 で表示と操作を確認済み。これより古い版は ZIP の展開に使う `DecompressionStream` の対応が足りません）

## セキュリティ

信頼できない第三者の EPUB を、自分のサイトの中に表示しても安全であることを目標にしています。書籍にさせないのは、スクリプトの実行、ページの移動、外部との通信の 3 つです。

### ライブラリが行うこと

- 書籍の各ページは sandbox 付きの iframe に表示し、Content-Security-Policy を挿入して、書籍内のスクリプト・埋め込み文書（`<iframe>` など）・外部へのリソース読み込みを禁止しています。ページを別の URL へ移動させる `<meta http-equiv="refresh">` と、文書を置き換える `<?xml-stylesheet?>`、スタイルシート以外の `<link>`（`rel="preconnect"` は、Content-Security-Policy があっても外部のサーバーへ接続させるブラウザがある）も取り除きます。リンク先のホスト名を先に調べておく DNS の先読みも切ります。本文として表示するのは XHTML / HTML の文書だけで、マニフェストがそのファイルを別の種類としても登録していても、必ずこの保護を掛けてから表示します。保護をすり抜ける手段になる `<noscript>` と `<template>`、文書のプロパティを置き換える `name` 属性（`<form name="documentElement">` など）は取り除き、文書は UTF-8 として読ませます（書籍が宣言する別の文字コードでは読ませません）。それでも書籍がページを別の場所へ移動させた場合は、そのページを表示せずに `error` イベントで知らせます。
- 書籍内の SVG など、スクリプトを含みうるファイルには、ページと同じオリジンを持つ blob: URL を使いません（読者が画像を新しいタブで開いても、中のスクリプトがページの権限で動かないように）。
- 書籍内のリンク（SVG 内のリンクや `<area>` を含む）は、本の中への移動か `http:` / `https:` / `mailto:` の外部リンクだけを扱い、`javascript:` などの URL は開きません。リンクのクリックはすべてビューアが受け取り、ブラウザに直接たどらせません（中クリックで新しいタブに開くこともさせません）。
- ZIP の展開は、ファイルごとに宣言されたサイズを超えた時点で打ち切ります（小さなデータが巨大に膨らむ細工への対策）。ただし、内容そのものが重い本（巨大な章、ブラウザの処理に時間のかかる細工）でページが重くなることまでは防げません。信頼できない本を扱うサイトでは、受け付けるファイルの大きさを制限してください。
- ランタイム依存はありません。開発用の依存（TypeScript、Playwright）はバージョンとハッシュを固定し、公開から 7 日未満の版はインストールしない設定にしています（`.npmrc`）。

### 組み込む側で気を付けること

- `loadCover()` が返す表紙は、画像として登録されたものだけです。ただし SVG の表紙（`blob.type` が `image/svg+xml`）はスクリプトを含められます。blob: URL にして `<img>` で表示するぶんには動きませんが、読者が「画像を新しいタブで開く」とページの権限で動きます。信頼できない本を扱うなら、SVG の表紙は `data:` URL にする（`FileReader.readAsDataURL()`）か、表示しないでください。
- 組み込み先のページに Content-Security-Policy ヘッダーを付ける場合は、書籍の表示に blob: URL を使うため、少なくとも `frame-src blob:`、`img-src blob: data:`、`style-src blob: 'unsafe-inline'`、`font-src blob: data:`、`media-src blob: data:` を許可してください（`default-src` で許可していれば不要）。`EpubReader` はツールバーのスタイルを `<style>` 要素で追加するので、`style-src 'unsafe-inline'` も必要です。`frame-src` の許可が足りず書籍のページを読み込めないとき、`open()` や `goTo()` などは reject されます。
- 組み込み先のページに `frame-ancestors 'none'` は付けないでください。Safari（WebKit）は、この指定を書籍のページ（blob: URL のフレーム）にも当てはめるので、ページが表示されなくなります（`open()` は reject されます）。ほかのサイトに埋め込ませたくない場合は、`frame-ancestors 'self'` か `X-Frame-Options` を使ってください。
- **ライブラリから受け取る値は、書籍が自由に決められます**。`book.metadata`（タイトルや著者）、`book.toc` の `label`、`error` イベントのメッセージ（ファイル名を含む）、`link` イベントの `href` は、HTML としてではなく文字列として表示してください（`innerHTML` ではなく `textContent`）。`link` の `href` は整えた URL ですが、行き先を判定するときは、文字列の前方一致ではなく `new URL(href)` の `hostname` などを使ってください（`https://許可するホスト@別のホスト/` のような URL があるため）。`sectionload` で渡される `doc` も書籍の文書そのものです。
- **読書位置の保存キー**（`EpubReader`）は、指定しなければ本の識別子（`dc:identifier`）で、これも書籍が決めます。別の本と同じ識別子を名乗れば、その本の読書位置を上書きできます。信頼できない本を扱うサイトでは、`open(source, { key })` で自分の ID を指定してください。
- **書籍は、自分のページの中では自由に表示できます**。入力欄やボタンを置く、音声や動画を自動再生する、ページ全体をリンクで覆う（クリックすると `link` イベントが発生し、止めなければ新しいタブで開きます）といったことは防ぎません。困る場合は、`sectionload` で渡される文書から該当する要素を取り除く、`link` イベントで確認を挟む、といった対応を組み込む側で行えます。
- **単体アプリ（`app/`）の `?url=`** は、渡された URL の本をそのまま開きます。単体アプリを公開する場合、リンクを踏ませるだけで任意の本を開かせられることを前提にしてください（上の保護はすべて働きます）。

## バージョンと互換性

バージョンは [セマンティックバージョニング](https://semver.org/lang/ja/) に従います。この README の「API」に書いたもの（`src/index.ts` から export しているもの）が公開 API で、互換性のない変更はメジャーバージョンを上げて行います。ツールバーの中の要素の構造やクラス名は、ここに書いたもの（`toolbar`、`.title`）を除いて公開 API ではありません。

バージョンごとの変更点は [リリース](https://github.com/ttk1/epub-viewer/releases) を参照してください。

## 開発

```sh
docker compose up                              # 開発サーバー（ページを再読み込みすると再ビルド）
docker compose run --rm node npm test          # 型チェック + Chromium / Firefox / WebKit でテスト
docker compose run --rm node npm run build     # dist/ を生成
```

| パス | 内容 |
| --- | --- |
| `src/` | ライブラリ本体。公開 API は `index.ts` |
| `app/` | 単体アプリ |
| `examples/` | 組み込み例 |
| `scripts/` | 開発サーバー、サンプル EPUB 生成、デモのサイトの組み立て |
| `.github/workflows/` | テストを通してから、デモを GitHub Pages に公開する |
| `test/` | Playwright テスト |

設計の考え方、モジュールの構成、開発時のチェックリストは [CLAUDE.md](CLAUDE.md) にまとめています。

## 作成について

このリポジトリのコードは、すべて [Claude Code](https://claude.com/claude-code)（Anthropic の AI コーディングツール）で作成しています。

## ライセンス

[MIT](LICENSE)
