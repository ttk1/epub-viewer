// Books made the way that tools other than nepub make them, and what goes wrong with pages at
// their edges: each test is a small book with the markup or CSS in question.
import { expect, test, type Page } from '@playwright/test'
import { makeBook, xhtml } from './helpers.ts'

const PAGE = '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>'
const SPINE = '<itemref idref="a"/>'
// A portrait illustration, larger than a page (an SVG file, so that the test needs no binary data).
const IMAGE: [string, string] = ['i.svg', '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#36c"/></svg>']
const IMAGE_ITEM = '<item id="i" href="i.svg" media-type="image/svg+xml"/>'
const VERTICAL = '<style>html { writing-mode: vertical-rl; }</style>'
const para = '<p>吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所でニャーニャー泣いていた事だけは記憶している。</p>'
const MARGIN = 32 // the default page margin

/** Opens the book in a viewer of its own over the (empty) app, and gives what `use` returns (or the error of opening it). */
const open = <T>(page: Page, bytes: number[], use: (viewer: any, book: any, doc: Document) => T | Promise<T>) =>
  page.evaluate(
    async ([bytes, use]) => {
      const { EpubViewer, openBook } = await import('/dist/src/index.js' as string)
      const container = document.createElement('div')
      container.style.cssText = 'position: fixed; inset: 0'
      document.body.append(container)
      const viewer = new EpubViewer(container)
      ;(window as any).last = undefined
      viewer.addEventListener('relocate', (e: CustomEvent) => ((window as any).last = e.detail))
      try {
        const book = await openBook(new Uint8Array(bytes))
        await viewer.open(book)
        const doc = () => [...container.querySelectorAll('iframe')].find((f) => getComputedStyle(f).visibility !== 'hidden')!.contentDocument
        return await new Function(`return (${use})`)()(viewer, book, doc())
      } catch (error) {
        return String(error)
      }
    },
    [bytes, use.toString()] as const,
  )

test.beforeEach(async ({ page }) => {
  await page.goto('/app/')
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const [name, head] of [['vertical', VERTICAL], ['horizontal', '']]) {
    test(`the last page of a section is a whole page, with its margins (${name})`, async ({ page }) => {
      const bytes = makeBook([['a.xhtml', xhtml(para.repeat(30), head)]], PAGE, SPINE, head ? 'rtl' : 'ltr')
      const result = await open(page, bytes, async (viewer, _book, doc) => {
        await viewer.goTo({ index: 0, progress: 1 })
        const { page: shown, pages } = (window as any).last
        const scroller = doc.scrollingElement!
        // Where the text of the last page is, in the frame.
        const range = doc.createRange()
        range.selectNodeContents(doc.body.lastElementChild!)
        const rects = [...range.getClientRects()].filter((r) => r.bottom > 0 && r.right > 0)
        return {
          last: shown === pages - 1 && pages > 1,
          scroll: Math.max(scroller.scrollTop, scroller.scrollLeft) / (shown * (scroller.scrollTop ? innerHeight : innerWidth)),
          top: Math.round(Math.min(...rects.map((r) => r.top))),
          left: Math.round(Math.min(...rects.map((r) => r.left))),
          bottom: Math.round(Math.max(...rects.map((r) => r.bottom))),
          right: Math.round(Math.max(...rects.map((r) => r.right))),
        }
      })
      expect(result).toMatchObject({ last: true, scroll: 1 }) // scrolled by whole pages
      const { top, left, bottom, right } = result as Record<string, number>
      expect(Math.min(top, left)).toBeGreaterThanOrEqual(MARGIN - 1)
      expect(bottom).toBeLessThanOrEqual(844 - MARGIN + 1)
      expect(right).toBeLessThanOrEqual(390 - MARGIN + 1)
    })
  }

  test('a section that begins with an illustration in a paragraph with margins has no empty page', async ({ page }) => {
    // <p><img/></p> with the margins that browsers give to <p> (no "p { margin: 0 }" in the book's CSS).
    const bytes = makeBook([['a.xhtml', xhtml(`<p><img src="i.svg" alt=""/></p>${para}`, VERTICAL)], IMAGE], PAGE + IMAGE_ITEM, SPINE, 'rtl')
    const result = await open(page, bytes, (_viewer, _book, doc) => {
      const r = doc.querySelector('img')!.getBoundingClientRect()
      return { pages: (window as any).last.pages, imageOnFirstPage: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth }
    })
    expect(result).toEqual({ pages: 2, imageOnFirstPage: true })
  })

  test('a margin after the last element of a section does not make an empty page', async ({ page }) => {
    // The last block ends 10px before the end of the column (780px high here), and its margin does not fit.
    const body = '<div style="block-size: 770px; margin-block-end: 16px">文</div>'
    const result = await open(page, makeBook([['a.xhtml', xhtml(body)]], PAGE, SPINE), () => (window as any).last.pages)
    expect(result).toBe(1)
  })

  test('an image in a <figure> is not cut at the edge of the page', async ({ page }) => {
    // <figure> has a margin of 40px on both sides by default.
    const bytes = makeBook([['a.xhtml', xhtml(`<figure><img src="i.svg" alt=""/><figcaption>図</figcaption></figure>`)], IMAGE], PAGE + IMAGE_ITEM, SPINE)
    const right = await open(page, bytes, (_viewer, _book, doc) => doc.querySelector('img')!.getBoundingClientRect().right)
    expect(right).toBeLessThanOrEqual(390 - MARGIN + 1)
  })

})

// As in books made from the template of the EBPAJ guide: white on black for a heading, a grey
// background for code. The viewer sets the color of the text, but not these backgrounds.
test('text on a background that the book gives it keeps the color of the book, in any theme', async ({ page }) => {
  const head = '<style>p { color: #000000; } .inverse { color: #ffffff; background: #000000; } .bg-silver { background-color: #c0c0c0; } .tint { background-color: rgba(0, 0, 0, 0.05); }</style>'
  const body =
    '<p id="plain">text <span id="code" class="bg-silver">j$.</span> <span id="tint" class="tint">tinted</span></p>' +
    '<p id="inverse" class="inverse">heading <b id="bold">bold</b></p><p class="bg-silver"><a id="link" href="http://example.com/">link</a></p>'
  const colors = await open(page, makeBook([['a.xhtml', xhtml(body, head)]], PAGE, SPINE), (viewer, _book, doc) => {
    const read = () => Object.fromEntries(['plain', 'code', 'tint', 'inverse', 'bold', 'link'].map((id) => [id, doc.defaultView!.getComputedStyle(doc.getElementById(id)!).color]))
    const light = read()
    viewer.setOptions({ theme: { background: '#000000', color: '#acacac', link: '#7fa3d9' } })
    return { light, dark: read() }
  })
  const [black, white] = ['rgb(0, 0, 0)', 'rgb(255, 255, 255)']
  // The text of the page, and text on a mere tint, are in the color of the theme.
  expect(colors).toMatchObject({
    light: { plain: 'rgb(26, 26, 26)', tint: 'rgb(26, 26, 26)', code: black, inverse: white, bold: white },
    dark: { plain: 'rgb(172, 172, 172)', tint: 'rgb(172, 172, 172)', code: black, inverse: white, bold: white },
  })
  // Nor is a link there in the color that the theme has for links, which is made for the background of the theme.
  const { light, dark } = colors as Record<string, Record<string, string>>
  expect(light.link).not.toBe('rgb(26, 95, 180)')
  expect(dark.link).toBe(light.link)
})

const DARK = "{ background: '#000000', color: '#acacac', link: '#7fa3d9' }"

// As Project Gutenberg makes them. The background of the page is the theme's, whatever the book says.
test('text is in the color of the theme when the book sets the colors of the page on <body>', async ({ page }) => {
  const head = '<style>body { color: black; background-color: white; }</style>'
  const use = `(viewer, _book, doc) => {
    viewer.setOptions({ theme: ${DARK} })
    return ['heading', 'text'].map((id) => doc.defaultView.getComputedStyle(doc.getElementById(id)).color)
  }`
  const colors = await open(page, makeBook([['a.xhtml', xhtml('<h1 id="heading">CONTENTS</h1><p id="text">text</p>', head)]], PAGE, SPINE), new Function(`return ${use}`)())
  expect(colors).toEqual(['rgb(172, 172, 172)', 'rgb(172, 172, 172)'])
})

// The same template draws all its rules and frames in black, whatever the page is.
test('rules and frames that the book draws in black can be seen on a dark page', async ({ page }) => {
  const body =
    '<p id="rule" style="border-bottom: 1px solid #000000">見出し</p><hr id="hr" style="border: none; border-top: 2px solid #000000"/>' +
    '<p id="red" style="border: 1px solid #ff0000">赤</p><table><tr><td id="cell" style="background: #ffffff; border: 1px solid #000000">表</td></tr></table>'
  const use = `(viewer, _book, doc) => {
    const read = () => Object.fromEntries([['rule', 'Bottom'], ['hr', 'Top'], ['red', 'Top'], ['cell', 'Top']].map(([id, side]) => [id, doc.defaultView.getComputedStyle(doc.getElementById(id))['border' + side + 'Color']]))
    const light = read()
    viewer.setOptions({ theme: ${DARK} })
    return { light, dark: read() }
  }`
  const colors = await open(page, makeBook([['a.xhtml', xhtml(body)]], PAGE, SPINE), new Function(`return ${use}`)())
  const [black, red, text] = ['rgb(0, 0, 0)', 'rgb(255, 0, 0)', 'rgb(172, 172, 172)']
  expect(colors).toEqual({
    light: { rule: black, hr: black, red, cell: black },
    dark: { rule: text, hr: text, red, cell: black }, // not what can be seen as it is, nor what is on a background of the book
  })
})

test('emphasis dots that the book gives a color of their own follow the theme, like the text', async ({ page }) => {
  const head = '<style>.em { -webkit-text-emphasis: sesame; text-emphasis: sesame; -webkit-text-emphasis-color: #000000; text-emphasis-color: #000000; }</style>'
  const use = `(viewer, _book, doc) => {
    viewer.setOptions({ theme: ${DARK} })
    const style = doc.defaultView.getComputedStyle(doc.getElementById('em'))
    return style.textEmphasisColor || style.webkitTextEmphasisColor
  }`
  const color = await open(page, makeBook([['a.xhtml', xhtml('<p>文<span id="em" class="em">強調</span></p>', head)]], PAGE, SPINE), new Function(`return ${use}`)())
  expect(color).toBe('rgb(172, 172, 172)')
})

// Characters that fonts do not have are small images of black on white (class "gaiji" in the same guide).
test('images of characters blend into the page, in any theme', async ({ page }) => {
  const body = '<p>文<img id="glyph" class="gaiji" src="i.svg" alt=""/>字 <span style="background: #c0c0c0"><img id="marked" class="gaiji-wide" src="i.svg" alt=""/></span><img id="picture" src="i.svg" alt=""/></p>'
  const use = `(viewer, _book, doc) => {
    const read = () => Object.fromEntries(['glyph', 'marked', 'picture'].map((id) => {
      const style = doc.defaultView.getComputedStyle(doc.getElementById(id))
      return [id, style.filter + ' ' + style.mixBlendMode]
    }))
    const light = read()
    viewer.setOptions({ theme: ${DARK} })
    return { light, dark: read() }
  }`
  const styles = await open(page, makeBook([['a.xhtml', xhtml(body)], IMAGE], PAGE + IMAGE_ITEM, SPINE), new Function(`return ${use}`)())
  expect(styles).toEqual({
    light: { glyph: 'none multiply', marked: 'none multiply', picture: 'none normal' },
    dark: { glyph: 'invert(1) screen', marked: 'none multiply', picture: 'none normal' }, // as the book has it on its own background
  })
})

test('code keeps its monospace font when the fonts of the book are replaced', async ({ page }) => {
  const body = '<p id="text">text <span id="code" style="font-family: monospace">j$.</span></p><pre id="pre">var foo = <b id="bold">1</b></pre><p id="gothic" style="font-family: sans-serif">見出し</p>'
  const fonts = await open(page, makeBook([['a.xhtml', xhtml(body)]], PAGE, SPINE), (viewer, _book, doc) => {
    viewer.setOptions({ fontFamily: 'serif' })
    return Object.fromEntries(['text', 'code', 'pre', 'bold', 'gothic'].map((id) => [id, doc.defaultView!.getComputedStyle(doc.getElementById(id)!).fontFamily]))
  })
  expect(fonts).toEqual({ text: 'serif', gothic: 'serif', code: 'monospace', pre: 'monospace', bold: 'monospace' })
})

test('a line of code that wraps is not spread over the width of the page', async ({ page }) => {
  // Justified like the text around it, the spaces of a wrapped line of code were stretched.
  const head = '<style>div { text-align: justify; }</style>'
  const body = '<div id="text">text</div><div id="code" style="font-family: monospace; white-space: pre-wrap">var foo = "method(" + argument1 + "," + argument2 + ")";</div>'
  const aligned = await open(page, makeBook([['a.xhtml', xhtml(body, head)]], PAGE, SPINE), (_viewer, _book, doc) =>
    ['text', 'code'].map((id) => doc.defaultView!.getComputedStyle(doc.getElementById(id)!).textAlign),
  )
  expect(aligned).toEqual(['justify', 'start'])
})

test('vertical text and upright numbers that are set with the -webkit- prefix only', async ({ page }) => {
  const css = '<style>html { -webkit-writing-mode: vertical-rl; } .tcy { -webkit-text-combine: horizontal; }</style>'
  const bytes = makeBook([['a.xhtml', xhtml('<p>平成<span class="tcy">12</span>年</p>', css)]], PAGE, SPINE, 'rtl')
  const result = await open(page, bytes, (_viewer, _book, doc) => [
    getComputedStyle(doc.body).writingMode,
    getComputedStyle(doc.querySelector('.tcy')!).textCombineUpright,
  ])
  expect(result).toEqual(['vertical-rl', 'all'])
})

test('the cover page that calibre makes keeps the shape of the image', async ({ page }) => {
  // calibre's titlepage.xhtml: the SVG is told to stretch (preserveAspectRatio="none").
  const svg = `<div><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="100%" height="100%" viewBox="0 0 800 1200" preserveAspectRatio="none"><image width="800" height="1200" xlink:href="i.svg"/></svg></div>`
  const head = '<style>@page { padding: 0pt; margin: 0pt } body { text-align: center; padding: 0pt; margin: 0pt; }</style>'
  const bytes = makeBook([['a.xhtml', xhtml(svg, head)], IMAGE], PAGE + IMAGE_ITEM, SPINE)
  const result = await open(page, bytes, (_viewer, _book, doc) => {
    const svg = doc.querySelector('svg')!
    const box = svg.getBoundingClientRect()
    return { stretched: svg.getAttribute('preserveAspectRatio') === 'none', shape: box.width / box.height }
  })
  // Either the box has the shape of the image (2:3), or the image is not stretched to the box.
  const { stretched, shape } = result as { stretched: boolean; shape: number }
  expect(!stretched || Math.abs(shape - 800 / 1200) < 0.01).toBe(true)
})

test('progress reaches the end in a book whose last sections are not part of the reading order', async ({ page }) => {
  // linear="no": notes that are only reached by links.
  const manifest = `${PAGE}<item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>`
  const bytes = makeBook([['a.xhtml', xhtml(para)], ['b.xhtml', xhtml(para.repeat(3))]], manifest, `${SPINE}<itemref idref="b" linear="no"/>`)
  const result = await open(page, bytes, async (viewer) => {
    let end = false
    viewer.addEventListener('bookend', () => (end = true))
    await viewer.next()
    return { end, fraction: (window as any).last.fraction }
  })
  expect(result).toEqual({ end: true, fraction: 1 })
})

test('the NCX is found without the toc attribute of the spine', async ({ page }) => {
  const ncx = '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap><navPoint><navLabel><text>第一章</text></navLabel><content src="a.xhtml"/></navPoint></navMap></ncx>'
  const manifest = `${PAGE}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`
  const result = await open(page, makeBook([['a.xhtml', xhtml(para)], ['toc.ncx', ncx]], manifest, SPINE), (_viewer, book) => book.toc)
  expect(result).toEqual([{ label: '第一章', href: 'a.xhtml', children: [] }])
})

test('XHTML that is not well-formed is still shown when it has empty elements in the XML way', async ({ page }) => {
  // &nbsp; is not known to XML without a DTD, so the file is read as HTML, where <title/> is not closed.
  const broken = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title/></head><body><p>一&nbsp;二</p><p>三</p></body></html>'
  const result = await open(page, makeBook([['a.xhtml', broken]], PAGE, SPINE), (_viewer, _book, doc) => doc.body.textContent)
  expect(result).toBe('一 二三')
})

/** A book of a section of `count` paragraphs, and another section after it. */
const twoSections = (count: number) =>
  makeBook(
    [['a.xhtml', xhtml(para.repeat(count))], ['b.xhtml', xhtml('<h1>B</h1>')]],
    `${PAGE}<item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>`,
    `${SPINE}<itemref idref="b"/>`,
  )

test('every next() in two columns goes forward, to the last page and on to the next section', async ({ page }) => {
  const backwards: unknown[] = []
  for (const count of [21, 23, 25, 27, 29, 31, 33, 35, 37]) {
    // Where the viewer is after each next(): not every relocate, which a re-layout repeats for the same page.
    const seen = await open(page, twoSections(count), async (viewer) => {
      viewer.setOptions({ spread: 'always' })
      const at = () => [(window as any).last.index, (window as any).last.page]
      const seen = [at()]
      while (viewer.location.index === 0) {
        await viewer.next()
        await new Promise((resolve) => setTimeout(resolve, 200)) // the scroll event comes later
        seen.push(at())
      }
      return seen
    })
    for (let i = 1; i < seen.length; i++) {
      if (seen[i][0] === seen[i - 1][0] && seen[i][1] <= seen[i - 1][1]) backwards.push({ count, seen })
    }
  }
  expect(backwards).toEqual([])
})
