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
    const seen = await open(page, twoSections(count), async (viewer) => {
      viewer.setOptions({ spread: 'always' })
      const seen: number[][] = []
      viewer.addEventListener('relocate', (e: CustomEvent) => seen.push([e.detail.index, e.detail.page, e.detail.pages]))
      while (viewer.location.index === 0) {
        await viewer.next()
        await new Promise((resolve) => setTimeout(resolve, 200)) // the scroll event comes later
      }
      return seen
    })
    for (let i = 1; i < seen.length; i++) {
      if (seen[i][0] === seen[i - 1][0] && seen[i][1] <= seen[i - 1][1]) backwards.push({ count, seen })
    }
  }
  expect(backwards).toEqual([])
})
