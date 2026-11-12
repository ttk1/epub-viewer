# epub-viewer

ブラウザで EPUB を表示するためのライブラリです。縦書きに対応し、リーダーアプリの画面表示部分として組み込んで使うことを想定しています。そのまま使える単体のリーダーアプリも付いています。

- **縦書き対応**: 縦書きの本は右から左へページが進みます。横書きの本を縦書きで表示することもできます
- **漫画などの固定レイアウト**: ページを画面に合わせて拡大縮小し、横長の画面では見開き（2 ページ並び）で表示します。右開き・左開きは本の指定に従います
- **ページ送り**: ← → ↑ ↓ キー、PageUp / PageDown / Space、ページの左右をクリック（タップ）、スワイプ、マウスホイール・トラックパッド。リモコン操作でもページが飛ばないようチャタリング対策済み
- **ダークモード・セピア**などのテーマ、明朝 / ゴシックの切り替え、文字サイズ・行間・表示幅の変更、目次、読書位置の保存と再開
- **組み込みやすさ**: フレームワーク非依存。ツールバー付きの画面ごと（`EpubReader`）でも、表示部分だけ（`EpubViewer`）でも組み込めます。イベントと位置情報（Location）で、次の話への自動遷移や本棚アプリからの再開などを実装できます
- **ランタイム依存ゼロ**: ZIP の展開もブラウザ標準の `DecompressionStream` で行います
- **EPUB 2 / 3** のリフロー型（小説など）と固定レイアウト（漫画など）に対応します

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
| ページの左 1/3・右 1/3 をクリック（タップ） | 左 / 右へページをめくる |
| 左右にスワイプ | 指で引いた方向へページをめくる（右へスワイプすると左のページ。縦書きなら次のページ） |
| マウスホイール・トラックパッド | 下へで次のページ、上へで前のページ（横方向は ← / → と同じ）。1 回の操作で 1 ページ |
| 目次 | 選んだ章へ移動。いま読んでいる章が強調される（項目が 1 つ以下の本では表示されない） |
| Aa | 表示設定（以下の 7 項目）を開く |
| 文字サイズ（A− / A＋） | 既定 45px、1 段階ごとに 1.2 倍 |
| 表示幅（全幅〜600） | ページを画面中央の指定幅（px）に収める（左右の余白をクリックしてもページをめくれる） |
| 行間（本の指定 / 狭い / 標準 / 広い / とても広い） | 既定は「本の指定」（本が行間を指定していなければ標準と同じ）。それ以外を選ぶと本の指定より優先する |
| 表示方向（自動 / 縦書き / 横書き） | 自動は本の指定に従う |
| 見開き（自動 / する / しない） | 固定レイアウトの本は 2 ページ並べ、横書きの本は 2 段組みにする。自動は画面に余裕があるとき（横長の画面、または 2 段組みにしても 1 段が狭くならない幅）だけ |
| テーマ（自動 / ライト / セピア / ダーク） | 既定の「自動」は OS のダークモード設定に合わせる |
| フォント（明朝 / ゴシック / 本の指定） | 既定は明朝。「本の指定」は書籍の CSS のフォントを使う |

文字サイズや表示方向、ウィンドウの大きさを変えても、読んでいた文章のあるページがそのまま表示されます。

ツールバーはキーボードでも操作できます（Tab で移動、Enter / Space で決定。目次は ↑ ↓ で項目を移動、Esc で閉じる）。メニューの外をクリックしても閉じます。

キーは押しっぱなしにしても 1 ページだけ進みます。また、ごく短い間隔（100ms 以内）の連続入力はチャタリングとみなして無視するので、リモコンでも 1 回押すごとに 1 ページずつめくれます。

固定レイアウトの本（漫画など）では、文字サイズ・フォント・行間・表示幅・表示方向の設定は働きません（ページの見た目が本の側で決まっているため）。ページ数の表示は本全体での「現在のページ / 総ページ数」になります。

読書位置と各設定（文字サイズ・フォント・行間・表示幅・表示方向・見開き・テーマ）はブラウザ（localStorage）に保存され、次に同じ本を開くと続きから表示されます。読書位置は本の識別子（`dc:identifier`）ごと、識別子がない本は URL やファイル名ごとに保存されます。

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

画面全体に表示してページ自体はスクロールさせない場合は、`body { margin: 0; overscroll-behavior: none; }` を指定しておくと、スマートフォンで縦に指を動かしたときにブラウザの「引っ張って更新」が働きません（`EpubReader` でも同じです）。

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

// ユーザーの操作（ページ送り・書籍内のリンク・EpubReader の目次）での移動が失敗した（壊れたセクションなど）ときの通知
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
| `metadata` | `{ identifier, title, creator, language, layout, direction }`。`identifier` は本によっては空。`layout` は `'reflowable'` か `'pre-paginated'`（固定レイアウト）、`direction` はページの進む向き（`'rtl'` = 右開き / `'ltr'`） |
| `sections` | 読む順のセクション一覧 `{ href, linear, size, spread? }[]`。`linear: false` はページ送りで飛ばされる。固定レイアウトでは 1 セクションが 1 ページで、`spread` は見開きでの位置（`'left'` / `'right'` / `'center'`、本に指定があるときだけ） |
| `toc` | 目次 `{ label, href, children }[]`（EPUB 3 の nav、なければ EPUB 2 の NCX） |
| `loadCover()` | 表紙画像の `Blob`（なければ `undefined`）。本棚のサムネイルなどに |
| `getUrl(path)` | アーカイブ内ファイルの blob: URL |
| `destroy()` | 作成した blob: URL を解放する。本を閉じるときに呼ぶ |

### `new EpubReader(root, options?)`

ツールバー（目次・進捗と、文字サイズ・フォント・行間・表示幅・表示方向・見開き・テーマの表示設定メニュー）と本文をまとめた画面です。ツールバーはテーマの色に合わせて表示されます。`root` には高さを与えてください。

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `storageKey` | `'epub-viewer'` | localStorage のキーの接頭辞。設定は `<storageKey>:settings`、読書位置は `<storageKey>:position:<キー>` に保存される。`''` で保存しない |
| `settings` | – | 初期設定 `{ theme, font, fontSize, lineHeight, maxWidth, writingMode, spread }`。`theme` は `'system'` / `'light'` / `'sepia'` / `'dark'`、`font` は `'mincho'` / `'gothic'` / `'book'`、それ以外は `EpubViewer` の同名のオプションと同じ。既定は OS に合わせたテーマ・明朝・45px・行間は本の指定・全幅・表示方向と見開きは自動。保存されるのはユーザーが変えた項目だけで、それ以外はここで指定した値が使われ続ける |
| `viewer` | – | 内部の `EpubViewer` に渡すオプション（`keyboard`・`wheel`・`swipe`・`cooldown` など）。見た目のオプションは設定から決まる |

| メソッド・プロパティ | 説明 |
| --- | --- |
| `open(source, { key?, location? })` | 本を開いて表示し、`Book` を返す。`location` を省略すると保存された位置（なければ先頭）から。`key` は読書位置の保存キー。読み込みが終わる前にもう一度呼ぶと後の呼び出しが優先され、どちらの呼び出しも後の本を返す |
| `toolbar` | ツールバーの要素。独自のボタンやリンクを追加できる（直下に置いた `button` / `select` / `a` / `label` にはツールバーの見た目が、`span` には文字用の余白が付く。作品名の要素は `.title`） |
| `viewer` | 内部の `EpubViewer`。イベントやページ移動に使う |
| `book` | 表示中の `Book` |
| `settings` | 現在の設定 |
| `setSettings(changes)` | 設定を変える（例: `reader.setSettings({ theme: 'sepia' })`）。ツールバーで変えたときと同じく表示に反映され、保存される。独自のボタンから設定を変えたいときに使う |
| `destroy()` | 画面を破棄する（表示中の `Book` も破棄する） |

### `new EpubViewer(container, options?)`

| オプション | 既定値 | 説明 |
| --- | --- | --- |
| `theme` | `themes.light` | `{ background, color, link }`。`themes.light` / `themes.dark` / `themes.sepia` または独自の色 |
| `fontFamily` | `''` | 本のフォントを上書きする CSS の font-family。`fonts.mincho`（明朝）/ `fonts.gothic`（ゴシック）は各 OS の和文フォントをまとめた指定。`''` は本の指定のまま |
| `fontSize` | `16` | 基準の文字サイズ（px）。本が em や % で指定した文字サイズはこれに比例する |
| `lineHeight` | `0` | 本文の行間（文字サイズに対する倍率）。本の指定より優先する。`0` は本の指定のまま（指定がなければ 1.6） |
| `writingMode` | `'auto'` | `'auto'`（本の指定に従う）/ `'vertical'` / `'horizontal'` |
| `margin` | `32` | ページ余白（px） |
| `maxWidth` | `0` | ページの最大幅（px）。コンテナの中央に表示し、左右の余白はテーマの背景色になる（余白のクリックでもページをめくれる）。`0` は全幅 |
| `keyboard` | `true` | ホストのウィンドウで ← → ↑ ↓ PageUp PageDown Space を受け付ける。入力欄にフォーカスがあるときは反応しない。スクロールするページに埋め込む場合、これらのキーはページのスクロールに使われなくなるので、必要なら `false` にして自前でキーを割り当てる |
| `click` | `true` | ページの左 1/3・右 1/3（と、幅を制限したときの左右の余白）のクリック・タップでページをめくる。クリックをアプリ側で使いたい場合（タップでメニューを出すなど）は `false` にし、`sectionload` で `e.detail.doc.documentElement` にリスナーを付ける（iOS の Safari は、`document` に付けたリスナーではタップを `click` にしない）。書籍内のリンクはどちらでも働く |
| `wheel` | `true` | ビューアの上でのマウスホイール・トラックパッドでページをめくる（1 回の操作で 1 ページ。下へで次、横方向は左右へめくる）。ビューア上ではページのスクロールに使われなくなるので、スクロールするページに埋め込む場合は必要なら `false` にする。Ctrl＋ホイール（拡大縮小）は妨げない |
| `spread` | `'auto'` | 見開き。固定レイアウトの本は 2 ページを並べ、横書きの本は 2 段組みにする。`'auto'`（余裕があるときだけ: 固定レイアウトは横長のコンテナ、横書きは 1 段が 20 文字分以上になる幅）/ `'always'` / `'never'`。縦書きの本は 1 ページが幅いっぱいなので変わらない |
| `swipe` | `true` | タッチ画面での左右のスワイプでページをめくる（指で引いた方向へ。右へスワイプすると左のページ）。ブラウザのタッチ操作（ページのスクロール、ピンチでの拡大、拡大中の移動）は妨げず、拡大表示中・文字の選択中・2 本指・縦方向の動きではめくらない |
| `cooldown` | `100` | ページ送りのキー・クリック・ホイール・スワイプを、直前の操作からこのミリ秒以内なら無視する（リモコンのチャタリング対策）。キーは押しっぱなしにしても 1 回押すごとに 1 ページだけ進む |

| メソッド・プロパティ | 説明 |
| --- | --- |
| `open(book, location?)` | 本を表示する。`location` は `Location` か目次の `href`。省略時は先頭 |
| `goTo(location)` | 指定位置へ移動 |
| `next()` / `prev()` | 次 / 前のページ（セクションの境界もまたぐ） |
| `goLeft()` / `goRight()` | 左 / 右へめくる（縦書きなら `goLeft()` が次のページ） |
| `setOptions(options)` | オプションを変更して再レイアウトする。ページ先頭にあった文章のあるページを表示し続ける |
| `location` | 現在位置 `{ index, progress }`（未表示なら `undefined`） |
| `options` | 現在のオプション |
| `book` | 表示中の `Book` |
| `destroy()` | ビューアを破棄する（`Book` の破棄は別途 `book.destroy()`） |

| イベント | `detail` | 発生するとき |
| --- | --- | --- |
| `relocate` | `{ index, progress, page, pages, fraction }` | 表示ページが変わった。`page` / `pages` はセクション内のページ番号（0 始まり）とページ数。固定レイアウトの本では本全体でのページ番号とページ数 |
| `bookend` | – | 最後のページで `next()` した |
| `bookstart` | – | 最初のページで `prev()` した |
| `sectionload` | `{ index, doc }` | セクションの文書を読み込んだ（レイアウト前） |
| `link` | `{ href }` | 外部リンク（`http:` / `https:` / `mailto:`）がクリックされた（キャンセル可能）。それ以外の URL（`javascript:` など）は開かない |
| `error` | `{ error }` | ユーザーの操作（キー・クリック・ホイール・スワイプでのページ送り、書籍内のリンク、`EpubReader` の目次）での移動に失敗した（壊れたセクションなど）。表示は元のページのまま。コードから呼んだ `next()` などは代わりに Promise が reject される |

TypeScript では `addEventListener` の `e.detail` に型が付きます。

## 対応範囲と制限

- 対応: EPUB 2 / 3 のリフロー型と固定レイアウト（`rendition:layout` が `pre-paginated` の本）、見開き表示、縦書き（`vertical-rl`）と横書き、ルビ、縦中横、目次（nav / NCX）、画像・CSS・フォントなど書籍内のリソース、`-epub-` 接頭辞付きの古い CSS プロパティ
- 固定レイアウトの見開きは、本が各ページの左右を指定していればそれに従い、指定がなければ最初のページ（表紙）を単独にして残りを 2 ページずつ並べます。ページの大きさは viewport の指定（なければページ内の SVG か画像の大きさ）から決めます。横長のページ（1 枚で見開きになっている絵）も 1 ページとして扱うので、見開きにすると小さくなります（その場合は見開きを「しない」に）
- ページを読み込む間も前のページを表示したままにし、読み込みが終わってから差し替えます（めくるたびに画面が白くなりません）。次のページのファイルは先に展開しておきます
- 未対応: スワイプ中に指に追従するページのアニメーション、右から左へ書く横書き（アラビア語など）、DRM 付きの EPUB、ZIP64（4GB 超）、書籍内のスクリプト、`<iframe>` / `<object>` / `<embed>` で埋め込まれた文書、本文（spine）に置かれた SVG など XHTML / HTML 以外の文書、XSLT（`<?xml-stylesheet?>`）（いずれも安全のため常に無効）
- 1 ページに収まらない行は折り返して表示します（改行できない「……」の連続や `<pre>` の長い行など）。ただし 1 ページより長いルビ、ページより幅の広い表、書籍の CSS で幅を固定した要素は折り返せず、次のページにはみ出します
- タッチ画面では、ページ端を続けてタップしたときに拡大されないよう、ダブルタップでの拡大だけを無効にしています（ピンチでの拡大は使えます）
- ブラウザのページ内検索（Ctrl+F）は、表示中のセクション（章）の中で使えます。見つかった場所からそのままページ送りを続けられます
- ブラウザ: 最新の Chrome / Edge / Firefox / Safari（テストは Chromium / Firefox / WebKit で実施）。少し古い版でも動きます（Chromium 104、Firefox 113、WebKit 16.4 で表示と操作を確認済み。これより古い版は ZIP の展開に使う `DecompressionStream` の対応が足りません）。古いブラウザも対象にするなら、ページ側の CSS では `100dvh` に `100vh` を併記してください（`height: 100vh; height: 100dvh;`）

## セキュリティ

- 書籍の各ページは sandbox 付きの iframe に表示し、Content-Security-Policy を挿入して、書籍内のスクリプト・埋め込み文書（`<iframe>` など）・外部へのリソース読み込みを禁止しています。ページを別の URL へ移動させる `<meta http-equiv="refresh">` と、文書を置き換える `<?xml-stylesheet?>` も取り除きます。本文として表示するのは XHTML / HTML の文書だけです（SVG などの文書にはこの保護を掛けられないため）。
- ZIP の展開は、ファイルごとに宣言されたサイズを超えた時点で打ち切ります（小さなデータが巨大に膨らむ細工への対策）。
- 書籍内のリンク（SVG 内のリンクや `<area>` を含む）は、本の中への移動か `http:` / `https:` / `mailto:` の外部リンクだけを扱い、`javascript:` などの URL は開きません。
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

## 作成について

このリポジトリのコードは、すべて [Claude Code](https://claude.com/claude-code)（Anthropic の AI コーディングツール）で作成しています。

## ライセンス

[MIT](LICENSE)
