# CLAUDE.md

ブラウザ用 EPUB ビューア（ライブラリ + 単体アプリ）。利用者向けの説明は README.md を参照。

## このファイルの運用

- ユーザーからの指示・方針・注意点のうち今後も継続して守るべきものは、明示的に頼まれなくても
  このファイルに反映する。ハマりどころや設計判断を見つけたときも同様。
- 追記のたびに全体を見直して整理する: 重複や古くなった記述は統合・削除し、該当する節に置く。
  1 項目は短く、理由が必要なものだけ理由を書く。
- このファイルもリポジトリにコミットされるので、下記「コミット前の確認」の対象に含まれる。

## 構成

| パス | 内容 |
| --- | --- |
| `src/zip.ts` | 最小 ZIP リーダー（stored / deflate のみ、`DecompressionStream` 使用） |
| `src/book.ts` | EPUB 解析（`openBook`）。リソースを blob: URL 化し、HTML/CSS の参照を書き換える |
| `src/viewer.ts` | `EpubViewer`。iframe + CSS 段組みでページ分割、縦書き、テーマ、キー操作、イベント |
| `src/index.ts` | 公開 API（ここから export したものだけが公開 API） |
| `app/` | 単体アプリ（ライブラリの利用例も兼ねる） |
| `examples/series.*` | 次話への自動遷移の組み込み例 |
| `scripts/` | 開発サーバー、サンプル EPUB 生成、テスト用 ZIP ライター（Node 専用・ブラウザには出さない） |
| `test/` | Playwright テスト（Chromium / Firefox / WebKit） |

## コマンド（必ず Docker 経由。ホストの node/npm は使わない）

```sh
docker compose up                              # 開発サーバー http://localhost:8080/app/
docker compose run --rm node npm test          # 型チェック + サンプル生成 + 全ブラウザテスト
docker compose run --rm node npm run build     # dist/ を生成
```

Windows の Git Bash から `docker` にコンテナ内パス（`/work` など）を渡すと Windows パスに
自動変換されるので、`MSYS_NO_PATHCONV=1` を前に付けて変換を無効にする。

## 毎回のチェックリスト（変更を終える前に必ず確認）

1. **テスト**: `docker compose run --rm node npm test` が 3 ブラウザすべてで通る。
   新しい機能・バグ修正にはテストを追加する。
2. **冗長さ・可読性**: 差分を読み返し、以下を確認する。
   - 使われていないコード・オプション・export が残っていないか（YAGNI）
   - 同じ処理の重複がないか、既存のヘルパーで書けないか
   - 名前が役割を表しているか、コメントは「なぜ」を書いているか
   - 構造をシンプルに保つ（ファイル・抽象化を増やす前に既存に収まらないか検討）
3. **ドキュメント**: 公開 API・オプション・イベント・操作方法を変えたら README.md を更新する。
   このファイルも「このファイルの運用」に従って更新する。
4. **nepub 互換**: nepub（https://github.com/ttk1/nepub）製 EPUB が第一の対象。
   `scripts/make-samples.js` の nepub 形式サンプルは nepub のテンプレートと同じ構造を保つ
   （`src/content.opf`、`navigation.xhtml`、`text/*.xhtml`、`span.tcy`、`dc:identifier` なし）。
5. **依存を増やさない**: ランタイム依存はゼロを維持する。追加が必要なら「サプライチェーン対策」の手順に従う。
6. **コミット前の確認**: コミット対象（コード・コメント・ドキュメント・テストデータ・このファイル）に
   コミットにふさわしくない情報が入っていないか確認する。
   - ローカル環境の情報: 絶対パス（ユーザー名を含むホームディレクトリ等）、ホスト名、
     個人のツール設定・シェル固有の回避策、ローカルにインストールされたツールのバージョン
   - 個人情報: 氏名、メールアドレス、アカウント名
   - 会話やプロンプトに含まれる個人的な内容・経緯（「〜さんの指示で」など）
   - 秘密情報: トークン、パスワード、社内 URL
   - 確認例: `git diff --cached | grep -n -i -E '/Users/|/home/|C:[/\\]|@[a-z0-9-]+\.[a-z]+|token|password'`
     （誤検知は目視で除外。`package-lock.json` の `resolved` が `registry.npmjs.org` のみであることも確認）
   - 開発者全般に当てはまる注意点（例: Docker Desktop のバインドマウントの制約、Git Bash の
     パス変換）は、特定の個人の環境に依存しない一般的な表現で書いてよい

## サプライチェーン対策

- devDependencies は `typescript` と `@playwright/test` のみ（どちらも公式パッケージ）。
- `.npmrc`: `ignore-scripts=true`（install スクリプトを実行しない）、`min-release-age=7`
  （公開後 7 日未満の版を入れない）、`save-exact=true`（バージョン完全固定）。
- `package-lock.json` をコミットし、integrity（sha512）で内容を固定。インストールは `npm ci`。
- Docker イメージは digest（`@sha256:...`）で固定。
- 依存を追加・更新するときは:
  1. 本当に必要か（自前で数十行で書けないか）を検討する
  2. 公式・実績のあるパッケージか、メンテナ・ダウンロード数・依存ツリーを確認する
  3. `npm view <pkg> time` で公開日を確認し、7 日以上経った版を exact 指定する
  4. `package-lock.json` の差分を確認する
  5. `@playwright/test` を更新したら `compose.yaml` のイメージのタグと digest も揃える
     （`docker pull mcr.microsoft.com/playwright:vX.Y.Z-noble` → `docker inspect --format '{{index .RepoDigests 0}}' ...`）

## 設計メモ・ハマりどころ

- **iframe の sandbox**: WebKit は `allow-scripts` なしの sandbox iframe では親から登録した
  イベントリスナーが発火しない。そのため `allow-same-origin allow-scripts` とし、書籍内の
  スクリプトは `Book` が各文書に挿入する CSP（`script-src 'none'`）で止めている。
  CSP を弱めると「does not run scripts in the book」テストが失敗する。
- **iframe の背景**: 親ページと iframe 内の文書で `color-scheme` が異なると、ブラウザは
  iframe の背後を不透明な白で塗る（ダークモードで背景が白いままになる）。そのため iframe 内の
  `html` にテーマの背景色を直接塗っている。見た目の不具合は computed style では検出できない
  ことがあるので、テストでは `pixel()` で実際の描画色を確認する。
- **ページ分割**: `html` 要素を段組みコンテナにし、padding m + column-gap 2m で各段が
  ページサイズの整数倍の位置から始まるようにしている。縦書きでは段が下方向に並ぶので
  ページ送りは `scrollTop`、横書きは `scrollLeft`。
- **コンテナ内の和文フォント**: Playwright イメージの既定フォールバックでは縦書きの漢字が
  重なって描画される（ライブラリの不具合ではない）。スクリーンショットで見た目を確認する
  ときは iframe 内で `font-family: IPAGothic` を指定する。
- **ファイル監視**: Docker Desktop のバインドマウント（特に Windows）ではファイル変更通知が
  コンテナに届かないことがあり、TS 7 の `tsc --watch` はポーリングに対応していない。そのため
  `scripts/serve.js --build` がページ読み込み時にソースの更新時刻を見て再ビルドする。
- import は `.ts` 拡張子で書く（`rewriteRelativeImportExtensions` で `.js` に書き換わる）。
