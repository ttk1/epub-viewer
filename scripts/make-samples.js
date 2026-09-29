// Generates sample EPUBs into samples/ for development and tests.
//   nepub.epub        : same structure as EPUBs made by nepub (https://github.com/ttk1/nepub), 3 episodes
//   episode-{1,2,3}.epub : nepub-style, one episode each (for examples/series.html)
//   general.epub      : EPUB 2 style (NCX, OEBPS/, horizontal English, image, @import, non-linear item)
import { mkdirSync, writeFileSync } from 'node:fs'
import { createZip } from './zip.js'

const container = (opfPath) => `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
    <rootfiles>
        <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml" />
    </rootfiles>
</container>`

// ---- nepub style (templates copied from nepub) ----

const nepubStyle = `body {
	writing-mode: vertical-rl;
	-webkit-writing-mode: vertical-rl;
	-epub-writing-mode: vertical-rl;
}
h1 { text-align: center; margin-top: 2em; margin-bottom: 2em; }
p { margin: 0; padding: 0; }
span.tcy {
	writing-mode: horizontal-tb;
	-webkit-writing-mode: horizontal-tb;
	-epub-writing-mode: horizontal-tb;
	line-height: 1;
}`

const japaneseParagraphs = (episode, count) =>
  Array.from({ length: count }, (_, i) => {
    const n = i + 1
    return [
      `　第<span class="tcy">${episode}</span>話の<span class="tcy">${n}</span>段落目。これは縦書き表示を確かめるためのサンプル文章です。`,
      `<ruby>吾輩<rt>わがはい</rt></ruby>は見本である。名前はまだ無い。`,
      `「かぎ括弧」や、句読点、長音記号ー、三点リーダ……の表示も確認できます。`,
    ].join('')
  })

function nepubEpub(title, episodes) {
  const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" xml:lang="ja">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title id="title">${esc(title)}</dc:title>
        <dc:creator id="creator01">サンプル作者</dc:creator>
        <dc:language>ja</dc:language>
        <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
        <meta name="primary-writing-mode" content="horizontal-rl"/>
    </metadata>
    <manifest>
        <item media-type="application/xhtml+xml" id="nav" href="navigation.xhtml" properties="nav" />
        <item media-type="text/css" id="style" href="style.css" />
        <item media-type="application/json" id="metadata" href="metadata.json" />
${episodes.map((e) => `        <item media-type="application/xhtml+xml" id="${e.id}" href="text/${e.id}.xhtml" />`).join('\n')}
    </manifest>
    <spine page-progression-direction="rtl">
${episodes.map((e) => `        <itemref linear="yes" idref="${e.id}" />`).join('\n')}
    </spine>
</package>`
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
    <head><meta charset="UTF-8" /><title>Navigation</title></head>
    <body>
        <nav epub:type="toc">
            <h1>Navigation</h1>
            <ol>
${episodes.map((e) => `                <li><a href="text/${e.id}.xhtml">${esc(e.title)}</a></li>`).join('\n')}
            </ol>
        </nav>
    </body>
</html>`
  const text = (e) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
    <head>
        <meta charset="UTF-8" />
        <title>${esc(e.title)}</title>
        <link href="../style.css" type="text/css" rel="stylesheet" />
    </head>
    <body>
        <h1>${esc(e.title)}</h1>
${e.paragraphs.map((p) => `        <p>${p}</p>`).join('\n')}
    </body>
</html>`
  return createZip([
    ['mimetype', 'application/epub+zip', true],
    ['META-INF/container.xml', container('src/content.opf')],
    ['src/content.opf', opf],
    ['src/style.css', nepubStyle],
    ['src/navigation.xhtml', nav],
    ['src/metadata.json', '{}'],
    ...episodes.map((e) => [`src/text/${e.id}.xhtml`, text(e)]),
  ])
}

const episode = (n) => ({ id: String(n), title: `第${n}話　サンプル`, paragraphs: japaneseParagraphs(n, 60) })

// ---- general EPUB 2 ----

function generalEpub() {
  const paragraphs = (chapter) =>
    Array.from(
      { length: 40 },
      (_, i) =>
        `<p>Chapter ${chapter}, paragraph ${i + 1}. The quick brown fox jumps over the lazy dog. ` +
        `This sample checks horizontal pagination, links and resource loading.</p>`,
    ).join('\n')
  const xhtml = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="../Styles/main.css"/></head>
<body>${body}</body>
</html>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="120"><rect width="200" height="120" fill="#4a90d9"/><text x="100" y="68" font-size="24" text-anchor="middle" fill="#fff">Sample</text></svg>`
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>General Sample</dc:title>
    <dc:creator opf:role="aut">Sample Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="BookId">urn:uuid:00000000-0000-4000-8000-000000000001</dc:identifier>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="Styles/main.css" media-type="text/css"/>
    <item id="base-css" href="Styles/base.css" media-type="text/css"/>
    <item id="cover-image" href="Images/cover.svg" media-type="image/svg+xml"/>
    <item id="probe" href="Images/probe.svg" media-type="image/svg+xml"/>
    <item id="ch1" href="Text/chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="Text/notes.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="Text/chapter%202.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="notes" linear="no"/>
    <itemref idref="ch2"/>
  </spine>
</package>`
  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="p1" playOrder="1"><navLabel><text>Chapter 1</text></navLabel><content src="Text/chapter1.xhtml"/></navPoint>
    <navPoint id="p2" playOrder="2"><navLabel><text>Chapter 2</text></navLabel><content src="Text/chapter%202.xhtml"/>
      <navPoint id="p3" playOrder="3"><navLabel><text>Section 2.1</text></navLabel><content src="Text/chapter%202.xhtml#section-2-1"/></navPoint>
    </navPoint>
  </navMap>
</ncx>`
  return createZip([
    ['mimetype', 'application/epub+zip', true],
    ['META-INF/container.xml', container('OEBPS/content.opf')],
    ['OEBPS/content.opf', opf],
    ['OEBPS/toc.ncx', ncx],
    ['OEBPS/Styles/main.css', '@import url("base.css");\nh1 { color: #a33; }'],
    ['OEBPS/Styles/base.css', 'body { font-family: serif; line-height: 1.6; }'],
    ['OEBPS/Images/cover.svg', svg],
    // Hostile content for security tests: must not run or navigate anywhere.
    ['OEBPS/Images/probe.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>top.document.body.dataset.hacked = "svg"</script></svg>'],
    [
      'OEBPS/Text/chapter1.xhtml',
      xhtml(
        'Chapter 1',
        `<h1>Chapter 1</h1><p><img id="cover" src="../Images/cover.svg" alt="cover"/></p>
<p><a id="to-2-1" href="chapter%202.xhtml#section-2-1">Go to section 2.1</a></p>
<p><a id="js-link" href="javascript:top.document.body.dataset.hacked='link'">Hostile link</a></p>
<script>document.body.dataset.hacked = "1"</script>
<meta http-equiv="refresh" content="1;url=https://example.invalid/"/>
<iframe src="../Images/probe.svg" width="1" height="1"></iframe>
<object data="../Images/probe.svg" width="1" height="1"></object>
<embed src="../Images/probe.svg" width="1" height="1"/>${paragraphs(1)}`,
      ),
    ],
    ['OEBPS/Text/notes.xhtml', xhtml('Notes', '<h1>Notes</h1><p>Non-linear item.</p>')],
    [
      'OEBPS/Text/chapter 2.xhtml',
      xhtml('Chapter 2', `<h1>Chapter 2</h1>${paragraphs(2)}<h2 id="section-2-1">Section 2.1</h2>${paragraphs(2.1)}`),
    ],
  ])
}

mkdirSync('samples', { recursive: true })
writeFileSync('samples/nepub.epub', nepubEpub('nepub 形式サンプル', [1, 2, 3].map(episode)))
for (const n of [1, 2, 3]) writeFileSync(`samples/episode-${n}.epub`, nepubEpub(`連載サンプル 第${n}話`, [episode(n)]))
writeFileSync('samples/general.epub', generalEpub())
console.log('Generated samples/*.epub')
