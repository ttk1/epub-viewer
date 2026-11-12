// Generates sample EPUBs into samples/ for development and tests.
//   nepub.epub        : same structure as EPUBs made by nepub (https://github.com/ttk1/nepub): 3 episodes
//                       in 2 chapters, each with an illustration, emphasis dots, an empty line and a
//                       run of "…" longer than a page
//   episode-{1,2,3}.epub : nepub-style, one episode each (for examples/series.html)
//   fixed.epub        : fixed layout (manga): one image per page, right to left, with the sides of the pages
//   fixed-plain.epub  : the same, without the sides
//   general.epub      : EPUB 2 style (NCX, OEBPS/, horizontal English, image, @import, non-linear item,
//                       long <pre> line), plus broken and hostile content and a last spine item missing
//                       from the archive
import { mkdirSync, writeFileSync } from 'node:fs'
import { crc32, deflateSync } from 'node:zlib'
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
}
em.emphasis-dots {
	font-style: normal;
	text-emphasis-style: sesame;
	-webkit-text-emphasis-style: sesame;
	-epub-text-emphasis-style: sesame;
}`

/** A plain single-color PNG, standing in for an illustration. */
function png(width, height, [r, g, b]) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc32(body), body.length + 4)
    return out
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2], 8) // 8 bits per channel, RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from([r, g, b]))])
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', header), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))])
}
// Portrait, and larger than a page, like the illustrations of web novels.
const illustration = { id: 'image1', name: 'image1.png', type: 'image/png', data: png(800, 1200, [74, 144, 217]) }

const japaneseParagraphs = (episode, count) =>
  Array.from({ length: count }, (_, i) => {
    const n = i + 1
    return [
      `　第<span class="tcy">${episode}</span>話の<span class="tcy">${n}</span>段落目。これは縦書き表示を確かめるためのサンプル文章です。`,
      `<ruby>吾輩<rt>わがはい</rt></ruby>は見本である。名前はまだ無い。`,
      `「かぎ括弧」や、句読点、長音記号ー、三点リーダ……の表示も確認できます。`,
    ].join('')
  })

/** `chapters`: [{ name, episodes }]. As in nepub, episodes of the chapter named "default" are listed without a chapter. */
function nepubEpub(title, chapters) {
  const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  const episodes = chapters.flatMap((chapter) => chapter.episodes)
  const images = [illustration]
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
${images.map((image) => `        <item media-type="${image.type}" id="${image.id}" href="image/${image.name}" />`).join('\n')}
    </manifest>
    <spine page-progression-direction="rtl">
${episodes.map((e) => `        <itemref linear="yes" idref="${e.id}" />`).join('\n')}
    </spine>
</package>`
  const navItem = (e, indent) => `${indent}<li>
${indent}    <a href="text/${e.id}.xhtml">${esc(e.title)}</a>
${indent}</li>`
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">
    <head>
        <meta charset="UTF-8" />
        <title>Navigation</title>
    </head>
    <body>
        <nav epub:type="toc">
            <h1>Navigation</h1>
            <ol>
${chapters
  .map((chapter) =>
    chapter.name === 'default'
      ? chapter.episodes.map((e) => navItem(e, ' '.repeat(16))).join('\n')
      : `                <li>
                    <a href="text/${chapter.episodes[0].id}.xhtml">${esc(chapter.name)}</a>
                    <ol>
${chapter.episodes.map((e) => navItem(e, ' '.repeat(24))).join('\n')}
                    </ol>
                </li>`,
  )
  .join('\n')}
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
    ...images.map((image) => [`src/image/${image.name}`, image.data]),
    ...episodes.map((e) => [`src/text/${e.id}.xhtml`, text(e)]),
    ['META-INF/container.xml', container('src/content.opf')],
    ['src/style.css', nepubStyle],
    ['src/content.opf', opf],
    ['src/navigation.xhtml', nav],
    ['src/metadata.json', '{}'],
  ])
}

// Web novels sometimes have a run of "…" longer than a page, which browsers do not break by themselves.
const longEllipsis = `　長い沈黙${'…'.repeat(100)}が続いた。`
// What nepub makes of an empty line, emphasis dots and an illustration.
const markup = [
  '<br />',
  '　これは<em class="emphasis-dots">傍点</em>の付いた文です。',
  `<img alt="挿絵" src="../image/${illustration.name}"/>`,
]
const episode = (n) => ({
  id: String(n),
  title: `第${n}話　サンプル`,
  paragraphs: [...japaneseParagraphs(n, 3), longEllipsis, ...japaneseParagraphs(n, 20), ...markup, ...japaneseParagraphs(n, 37)],
})

// ---- fixed layout (manga) ----

/** Pages of 600 × 900, each a single image, read from right to left. The book says which side each page is on. */
function fixedEpub(title, sides) {
  const pages = sides.map((side, i) => ({ id: `p${i + 1}`, side, image: png(600, 900, [(40 * i) % 256, 120, 255 - ((40 * i) % 256)]) }))
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" xml:lang="ja" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="id">urn:uuid:00000000-0000-4000-8000-000000000002</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>ja</dc:language>
    <meta property="dcterms:modified">2026-01-01T00:00:00Z</meta>
    <meta property="rendition:layout">pre-paginated</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
${pages.map((p) => `    <item id="${p.id}" href="${p.id}.xhtml" media-type="application/xhtml+xml"/>
    <item id="${p.id}-image" href="${p.id}.png" media-type="image/png"/>`).join('\n')}
  </manifest>
  <spine page-progression-direction="rtl">
${pages.map((p) => `    <itemref idref="${p.id}"${p.side ? ` properties="${p.side}"` : ''}/>`).join('\n')}
  </spine>
</package>`
  const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Navigation</title></head>
<body><nav epub:type="toc"><ol><li><a href="p1.xhtml">表紙</a></li><li><a href="p4.xhtml">第2話</a></li></ol></nav></body></html>`
  const page = (p, n) => `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page ${n}</title>
<meta name="viewport" content="width=600, height=900"/>
<style>body { margin: 0; } img { display: block; width: 600px; height: 900px; }</style></head>
<body><img src="${p.id}.png" alt="${n} ページ"/></body></html>`
  return createZip([
    ['mimetype', 'application/epub+zip', true],
    ['META-INF/container.xml', container('content.opf')],
    ['content.opf', opf],
    ['nav.xhtml', nav],
    ...pages.flatMap((p, i) => [[`${p.id}.xhtml`, page(p, i + 1)], [`${p.id}.png`, p.image, true]]),
  ])
}

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
  const hack = (by) => `<script>top.document.body.dataset.hacked = "${by}"</script>`
  const xslt = `<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>XSLT</h1>${hack('xslt')}</body></html></xsl:template></xsl:stylesheet>`
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
    <item id="missing" href="Text/missing.xhtml" media-type="application/xhtml+xml"/>
    <item id="malformed" href="http://[" media-type="text/plain"/>
    <item id="cycle-a" href="Styles/cycle-a.css" media-type="text/css"/>
    <item id="cycle-b" href="Styles/cycle-b.css" media-type="text/css"/>
    <item id="cyclic" href="Text/cyclic.xhtml" media-type="application/xhtml+xml"/>
    <item id="dup" href="Text/dup.xhtml" media-type="application/xhtml+xml"/>
    <item id="dup-again" href="Text/dup.xhtml" media-type="image/svg+xml"/>
    <item id="noscript" href="Text/noscript.html" media-type="text/html"/>
    <item id="shadow" href="Text/shadow.html" media-type="text/html"/>
    <item id="links" href="Text/links.xhtml" media-type="application/xhtml+xml"/>
    <item id="nohead" href="Text/nohead.xhtml" media-type="application/xhtml+xml"/>
    <item id="svgroot" href="Text/svgroot.xhtml" media-type="application/xhtml+xml"/>
    <item id="xslt" href="Text/xslt.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1"/>
    <itemref idref="notes" linear="no"/>
    <itemref idref="cyclic" linear="no"/>
    <itemref idref="probe" linear="no"/>
    <itemref idref="dup" linear="no"/>
    <itemref idref="noscript" linear="no"/>
    <itemref idref="shadow" linear="no"/>
    <itemref idref="links" linear="no"/>
    <itemref idref="nohead" linear="no"/>
    <itemref idref="svgroot" linear="no"/>
    <itemref idref="xslt" linear="no"/>
    <itemref idref="ch2"/>
    <itemref idref="missing"/>
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
    // url(#marker) refers to the document itself, not to a file in the archive.
    ['OEBPS/Styles/main.css', '@import url("base.css");\nh1 { color: #a33; }\npath { marker-start: url(#marker); }'],
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
<p id="inline-style" style="background-image: url(../Images/cover.svg)"><img id="srcset" src="../Images/cover.svg" srcset="../Images/cover.svg 2x" width="50" alt=""/>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="50" height="30"><image id="svg-image" width="50" height="30" xlink:href="../Images/cover.svg"/></svg></p>
<pre id="long-pre">${'const longLine = 1; '.repeat(40)}</pre>
<p><a id="js-link" href="javascript:top.document.body.dataset.hacked='link'">Hostile link</a>
<a id="to-notes" href="notes.xhtml">notes</a> <a id="to-cyclic" href="cyclic.xhtml">cyclic</a>
<a id="to-dup" href="dup.xhtml">dup</a> <a id="to-noscript" href="noscript.html">noscript</a>
<a id="to-shadow" href="shadow.html">shadow</a> <a id="to-links" href="links.xhtml">links</a>
<a id="to-probe" href="../Images/probe.svg">probe</a> <a id="to-nohead" href="nohead.xhtml">nohead</a>
<a id="to-svgroot" href="svgroot.xhtml">svgroot</a> <a id="to-xslt" href="xslt.xhtml">xslt</a></p>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="200" height="30"><a id="svg-link" xlink:href="chapter%202.xhtml"><text x="0" y="20">SVG link</text></a></svg>
<script>document.body.dataset.hacked = "1"</script>
<meta http-equiv="refresh" content="1;url=https://example.invalid/"/>
<iframe src="../Images/probe.svg" width="1" height="1"></iframe>
<object data="../Images/probe.svg" width="1" height="1"></object>
<embed src="../Images/probe.svg" width="1" height="1"/>${paragraphs(1)}`,
      ),
    ],
    // Not well-formed (<br>): read with the HTML parser.
    ['OEBPS/Text/notes.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>注記</h1><p>Non-linear item.<br></p></body></html>'],
    // Stylesheets that import each other: neither can get a URL that contains the URL of the other.
    ['OEBPS/Styles/cycle-a.css', '@import "cycle-b.css";\nh1 { letter-spacing: 1px; }'],
    ['OEBPS/Styles/cycle-b.css', '@import "cycle-a.css";'],
    [
      'OEBPS/Text/cyclic.xhtml',
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="../Styles/cycle-a.css"/><link rel="stylesheet" href="../Styles/cycle-b.css"/></head><body><h1>Cyclic</h1></body></html>',
    ],
    // Listed twice in the manifest, the second time as something that is not rewritten.
    ['OEBPS/Text/dup.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Dup</title></head><body><h1>Dup</h1>${hack('dup')}</body></html>`],
    // Ways of leaving the book that are not there when the document is rewritten (scripts are off
    // then), but are when it is shown (scripts are "on", only blocked): a comment that ends inside
    // <noscript>, and a link inside a declarative shadow root.
    [
      'OEBPS/Text/noscript.html',
      '<html><head><title>Noscript</title></head><body><h1>Noscript</h1><noscript><!--</noscript><meta http-equiv="refresh" content="0;url=about:blank">--></noscript></body></html>',
    ],
    [
      'OEBPS/Text/shadow.html',
      '<html><head><title>Shadow</title></head><body><h1>Shadow</h1><div id="host">Host<template shadowrootmode="open"><a href="about:blank" style="display:block;height:100px">Leave</a></template></div></body></html>',
    ],
    // A link whose target is only given by an animation.
    [
      'OEBPS/Text/links.xhtml',
      xhtml('Links', '<h1>Links</h1><svg xmlns="http://www.w3.org/2000/svg" width="300" height="40"><a id="animated-link"><set attributeName="href" to="about:blank"/><text x="0" y="30" font-size="30">Leave</text></a></svg>'),
    ],
    // Spine items where a CSP <meta> would not take effect: no <head>, a root that is not <html>,
    // and a document replaced by the output of an XSLT stylesheet.
    ['OEBPS/Text/nohead.xhtml', `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>No head</h1>${hack('nohead')}</body></html>`],
    ['OEBPS/Text/svgroot.xhtml', `<svg xmlns="http://www.w3.org/2000/svg">${hack('svgroot')}</svg>`],
    [
      'OEBPS/Text/xslt.xhtml',
      `<?xml-stylesheet type="text/xsl" href="data:text/xml;base64,${btoa(xslt)}"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>XSLT</title></head><body><h1>XSLT</h1></body></html>`,
    ],
    [
      'OEBPS/Text/chapter 2.xhtml',
      xhtml('Chapter 2', `<h1>Chapter 2</h1><p><a id="to-missing" href="missing.xhtml">Missing</a> <a id="to-local" href="#section-2-1">Section 2.1</a></p>${paragraphs(2)}<h2 id="section-2-1">Section 2.1</h2>${paragraphs(2.1)}`),
    ],
  ])
}

mkdirSync('samples', { recursive: true })
writeFileSync(
  'samples/nepub.epub',
  nepubEpub('nepub 形式サンプル', [
    { name: '第一章', episodes: [episode(1), episode(2)] },
    { name: '第二章', episodes: [episode(3)] },
  ]),
)
// Per-episode EPUBs usually share the novel's title (and have no identifier).
for (const n of [1, 2, 3]) writeFileSync(`samples/episode-${n}.epub`, nepubEpub('連載サンプル', [{ name: 'default', episodes: [episode(n)] }]))
writeFileSync('samples/general.epub', generalEpub())
// A cover, then pairs (the right page first), and a last page without a partner.
writeFileSync(
  'samples/fixed.epub',
  fixedEpub('固定レイアウトサンプル', [
    'rendition:page-spread-center',
    'page-spread-right',
    'page-spread-left',
    'page-spread-right',
    'page-spread-left',
    'page-spread-right',
  ]),
)
// The same without sides, as many books are made.
writeFileSync('samples/fixed-plain.epub', fixedEpub('固定レイアウトサンプル', Array(25).fill('')))
console.log('Generated samples/*.epub')
