// Books made for one test each: broken ones, and hostile ones that need what only the test knows.
import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:net'
import { content, makeBook, xhtml } from './helpers.ts'

const PAGE = '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>'
const text = '<h1>Page</h1>' + '<p>The quick brown fox jumps over the lazy dog.</p>'.repeat(5)

/** Opens the book in a viewer of its own over the (empty) app, and gives what `use` returns (or the error of opening it). */
const open = <T>(page: Page, bytes: number[], use: (viewer: any, book: any) => T | Promise<T> = () => undefined as T) =>
  page.evaluate(
    async ([bytes, use]) => {
      const { EpubViewer, openBook } = await import('/dist/src/index.js' as string)
      const container = document.createElement('div')
      container.style.cssText = 'position: fixed; inset: 0'
      document.body.append(container)
      const viewer = new EpubViewer(container)
      viewer.addEventListener('link', (e: CustomEvent) => {
        e.preventDefault()
        document.body.dataset.link = e.detail.href
      })
      viewer.addEventListener('error', (e: CustomEvent) => (document.body.dataset.error = String(e.detail.error)))
      try {
        const book = await openBook(new Uint8Array(bytes))
        await viewer.open(book)
        return await new Function(`return (${use})`)()(viewer, book)
      } catch (error) {
        return String(error)
      }
    },
    [bytes, use.toString()] as const,
  )

test.beforeEach(async ({ page }) => {
  await page.goto('/app/')
})

/** A server that counts the connections made to it: one made ahead of time (rel="preconnect") is not a request yet. */
async function listen(): Promise<{ url: string; connections: () => number }> {
  let connections = 0
  const server = createServer((socket) => {
    connections++
    socket.on('error', () => {})
    socket.end('HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    connections: () => (server.close(), connections),
  }
}

// A book could tell its author who reads it, and when.
test('does not reach a server that the book names', async ({ page }) => {
  const { url, connections } = await listen()
  const head = `<link rel="preconnect" href="${url}/"/><link rel="stylesheet" href="${url}/style.css"/><link rel="stylesheet preconnect" href="${url}/"/>`
  const body = `${text}<p style="background: url(${url}/background.png)"><img src="${url}/image.png" alt=""/></p>`
  await open(page, makeBook([['a.xhtml', xhtml(body, head)]], PAGE, '<itemref idref="a"/>'))
  await page.waitForTimeout(1000)
  expect(connections()).toBe(0)
})

test('does not reach a server by a <link> that is only there when the HTML is read again', async ({ page }) => {
  // The <link> is text (inside <style>) when the document is rewritten, and an element in what is written out.
  const { url, connections } = await listen()
  const source = `<html><head></head><body><p>text</p><form><math><mtext></form><form><mglyph><style></math><link rel=preconnect href="${url}/"><p>after`
  await open(page, makeBook([['a.html', source]], '<item id="a" href="a.html" media-type="text/html"/>', '<itemref idref="a"/>'))
  await page.waitForTimeout(1000)
  expect(await content(page).evaluate(() => document.querySelectorAll('link').length)).toBe(0)
  expect(connections()).toBe(0)
})

test('does not follow a link that is drawn by <use>, whatever gives the <use> its target', async ({ page }) => {
  // A click on what <use> draws is a click on the <use>, which has no href of its own here: an animation sets it.
  const { url, connections } = await listen()
  const svg = (attribute: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="300" height="100"><defs><g id="g-${attribute}"><a href="${url}/"><rect width="300" height="100" fill="red"/></a></g></defs><use class="use"><set attributeName="${attribute}" to="#g-${attribute}"/></use></svg>`
  await open(page, makeBook([['a.xhtml', xhtml(svg('href') + svg('xlink:href') + text)]], PAGE, '<itemref idref="a"/>'))
  for (const box of await content(page).locator('.use').evaluateAll((uses) => uses.map((use) => use.getBoundingClientRect().toJSON()))) {
    if (box.width) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await page.waitForTimeout(400)
  }
  expect(connections()).toBe(0)
  expect(await page.evaluate(() => document.body.dataset.error)).toBeUndefined() // the frame did not leave its page
})

test('a file whose type only begins like that of an image is not given the origin of the page', async ({ page }) => {
  // Browsers take the type after the comma: opened by the reader as a page of its own, this would be an HTML document.
  const manifest = `${PAGE}<item id="i" href="i.bin" media-type="image/png,text/html"/>`
  const bytes = makeBook([['a.xhtml', xhtml(`<img src="i.bin" alt=""/>${text}`)], ['i.bin', '<html><body>not an image</body></html>']], manifest, '<itemref idref="a"/>')
  await open(page, bytes)
  expect(await content(page).evaluate(() => document.querySelector('img')!.src)).toMatch(/^data:/)
})

test('a url( in CSS that does not end, after a long run of spaces, does not hold up the page', async ({ page }) => {
  // About a kilobyte as a file. It took the search for URLs in the CSS a minute or more.
  const css = `h1 { letter-spacing: 1px; } p { background: url(${' '.repeat(20000)}( }`
  const start = Date.now()
  await Promise.race([open(page, makeBook([['a.xhtml', xhtml(text, `<style>${css}</style>`)]], PAGE, '<itemref idref="a"/>')), page.waitForTimeout(10000)])
  expect(Date.now() - start).toBeLessThan(5000)
  expect(await content(page).evaluate(() => getComputedStyle(document.querySelector('h1')!).letterSpacing)).toBe('1px')
})

test('EpubReader does not let a book fill the storage with its name', async ({ page }) => {
  const bytes = makeBook([['a.xhtml', xhtml(text)]], PAGE, '<itemref idref="a"/>', 'ltr', 'a very long identifier '.repeat(10000))
  const keys = await page.evaluate(async (bytes) => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const written: string[] = []
    const reader = new EpubReader(document.getElementById('reader')!, { storage: { getItem: () => null, setItem: (key: string) => void written.push(key) } })
    await reader.open(new Uint8Array(bytes))
    return written.filter((key) => key.includes('position')).map((key) => key.length)
  }, bytes)
  expect(keys.length).toBeGreaterThan(0)
  expect(Math.max(...keys)).toBeLessThan(1000)
})

test('external links are reported, and the browser does not follow them by itself with another mouse button', async ({ page, context }) => {
  const body = `${text}<p><a id="link" href=" https://example.com/ ">Out</a></p>`
  await open(page, makeBook([['a.xhtml', xhtml(body)]], PAGE, '<itemref idref="a"/>'))
  let tabs = 0
  context.on('page', () => tabs++)
  await content(page).locator('#link').click({ button: 'middle' }) // would open a tab past the link event
  await page.waitForTimeout(500)
  expect(tabs).toBe(0)
  await content(page).locator('#link').click()
  await expect.poll(() => page.evaluate(() => document.body.dataset.link)).toBe('https://example.com/')
  expect(tabs).toBe(0) // the app has taken the link over
})

test('a horizontal page of a book that is read from right to left turns the way the book goes', async ({ page }) => {
  // As publishers make them: vertical text, with a cover (or a colophon) laid out horizontally.
  const vertical = xhtml(text, '<style>html { writing-mode: vertical-rl; }</style>')
  const manifest = `${PAGE}<item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>`
  const bytes = makeBook([['a.xhtml', xhtml('<h1>Cover</h1>')], ['b.xhtml', vertical]], manifest, '<itemref idref="a"/><itemref idref="b"/>', 'rtl')
  const result = await open(page, bytes, async (viewer) => {
    // Where the viewer is after each step: not every relocate, which a re-layout repeats for the same page.
    let last: unknown[] = []
    viewer.addEventListener('relocate', (e: CustomEvent) => (last = [e.detail.index, e.detail.rtl]))
    const seen: unknown[] = []
    await viewer.goLeft() // on to the text, not back past the start of the book
    seen.push(last)
    viewer.setOptions({ writingMode: 'horizontal' }) // horizontal text that the reader asked for goes to the right
    seen.push(last)
    await viewer.goLeft()
    seen.push(last)
    return seen
  })
  expect(result).toEqual([[1, true], [1, false], [0, false]])
})

test('opens a book whose table of contents is missing from the archive', async ({ page }) => {
  const manifest = `${PAGE}<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>`
  const result = await open(page, makeBook([['a.xhtml', xhtml(text)]], manifest, '<itemref idref="a"/>'), (viewer, book) => ({
    toc: book.toc,
    location: viewer.location,
  }))
  expect(result).toEqual({ toc: [], location: { index: 0, progress: 0 } })
})

test('says so when a book has nothing that can be shown', async ({ page }) => {
  // The only spine item is an SVG document, which is not shown (its scripts could not be stopped).
  const manifest = '<item id="a" href="a.svg" media-type="image/svg+xml"/>'
  const result = await open(page, makeBook([['a.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>']], manifest, '<itemref idref="a"/>'))
  expect(result).toContain('nothing to show')
})

test('images declared as image/jpg are files of the page like other bitmaps', async ({ page }) => {
  // A common mistake for image/jpeg. (The file is not looked into: what counts is that a blob: URL is used.)
  const manifest = `${PAGE}<item id="i" href="i.jpg" media-type="image/jpg"/>`
  const bytes = makeBook([['a.xhtml', xhtml(`<img src="i.jpg" alt=""/>${text}`)], ['i.jpg', 'not looked into']], manifest, '<itemref idref="a"/>')
  await open(page, bytes)
  expect(await content(page).evaluate(() => document.querySelector('img')!.src)).toMatch(/^blob:/)
})

// A book that cannot be shown: nothing in its spine that is shown, or a first section that is missing from the archive.
const UNSHOWN = {
  'no sections': makeBook([['a.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>']], '<item id="a" href="a.svg" media-type="image/svg+xml"/>', '<itemref idref="a"/>'),
  'a broken first section': makeBook([], PAGE, '<itemref idref="a"/>'),
}
for (const [name, bytes] of Object.entries(UNSHOWN)) {
  test(`a book that fails to open (${name}) leaves the book before it shown and working`, async ({ page }) => {
    const result = await page.evaluate(async (bytes) => {
      const { EpubReader } = await import('/dist/src/index.js' as string)
      const root = document.createElement('div')
      root.style.height = '100vh'
      document.body.replaceChildren(root)
      const saved: Record<string, string> = {}
      const storage = { getItem: (key: string) => saved[key] ?? null, setItem: (key: string, value: string) => void (saved[key] = value) }
      const reader = new EpubReader(root, { storage, storageKey: 's' })
      const good = await reader.open('/samples/nepub.epub', { key: 'good' })
      const error = await reader.open(new Uint8Array(bytes), { key: 'bad' }).then(() => '', String)
      // The book before goes on: page turns, also into other sections (its files can still be read).
      await reader.viewer.next()
      await reader.viewer.goTo({ index: -1, progress: 0 })
      return {
        failed: error !== '',
        book: reader.book === good && reader.viewer.book === good,
        title: root.querySelector('.title')!.textContent,
        toc: !root.querySelector<HTMLElement>('.toc')!.hidden,
        index: reader.viewer.location.index,
        saved: Object.keys(saved).filter((key) => key.includes('position')),
      }
    }, bytes)
    expect(result).toEqual({ failed: true, book: true, title: 'nepub 形式サンプル', toc: true, index: 2, saved: ['s:position:good'] })
  })
}

test('the arrow keys in the table of contents pass over headings that lead nowhere', async ({ page }) => {
  const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>
    <li><a href="a.xhtml">A</a></li><li><span>Part 2</span><ol><li><a href="b.xhtml">B</a></li></ol></li></ol></nav></body></html>`
  const manifest = `${PAGE}<item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>`
  const bytes = makeBook([['a.xhtml', xhtml(text)], ['b.xhtml', xhtml(text)], ['nav.xhtml', nav]], manifest, '<itemref idref="a"/><itemref idref="b"/>')
  await page.evaluate(async (bytes) => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    await new EpubReader(document.getElementById('reader')!, { storage: null }).open(new Uint8Array(bytes))
  }, bytes)
  await page.locator('.toc summary').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('button', { name: 'B', exact: true })).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('button', { name: 'A', exact: true })).toBeFocused()
})

// The cover is given to the app as it is in the archive. Shown on a shelf by a blob: URL, as is
// usual for a Blob, and opened by the reader in a tab of its own, an HTML "cover" ran as the host.
for (const type of ['', 'text/html', 'application/xhtml+xml', 'image/png,text/html']) {
  test(`a cover declared as "${type}" does not run as the host when opened in a tab of its own`, async ({ page }) => {
    const cover = '<html xmlns="http://www.w3.org/1999/xhtml"><body><script>localStorage.setItem("pwned", location.origin)</script>cover</body></html>'
    const manifest = `${PAGE}<item id="c" href="cover.html" media-type="${type}" properties="cover-image"/>`
    const bytes = makeBook([['a.xhtml', xhtml(text)], ['cover.html', cover]], manifest, '<itemref idref="a"/>')
    // As the README tells apps to do: SVG as a data: URL, the rest as a blob: URL.
    const url = await open(page, bytes, async (_viewer, book) => {
      const blob: Blob | undefined = await book.loadCover()
      return blob && blob.type !== 'image/svg+xml' ? URL.createObjectURL(blob) : ''
    })
    if (url) {
      const popup = page.waitForEvent('popup')
      await page.evaluate((url) => void window.open(url), url) // "open image in new tab"
      await (await popup).waitForLoadState().catch(() => {})
      await page.waitForTimeout(1000)
    }
    expect(await page.evaluate(() => localStorage.getItem('pwned'))).toBeNull()
  })
}

// Firefox looks up the names of the links in a page ahead of time (DNS prefetch), also for a
// blob: document of an https: page, where it would not for the page itself. A book could tell who
// reads it by the names that it makes up. The browser's own setting can only be turned off.
test('the documents of the book turn off DNS prefetching before anything else', async ({ page }) => {
  const head = '<meta http-equiv="x-dns-prefetch-control" content="on"/>'
  await open(page, makeBook([['a.xhtml', xhtml(`${text}<a href="http://example.invalid/">x</a>`, head)]], PAGE, '<itemref idref="a"/>'))
  const metas = await content(page).evaluate(() =>
    [...document.querySelectorAll('meta[http-equiv]')].map((m) => [m.getAttribute('http-equiv')!.toLowerCase(), m.getAttribute('content')!.toLowerCase()]),
  )
  // Right after the CSP, before what the book says ("off" cannot be turned on again).
  expect(metas[0][0]).toBe('content-security-policy')
  expect(metas[1]).toEqual(['x-dns-prefetch-control', 'off'])
})

// Reading an NCX took time in proportion to (depth of the entries) × (size of the file): every
// entry searched all of what is under it for its label.
test('a table of contents of nested entries over a large NCX is read in time proportional to its size', async ({ page }) => {
  const depth = 1000
  const entries = Array.from({ length: depth }, (_, i) => `<navPoint id="p${i}"><navLabel><text>${i}</text></navLabel><content src="a.xhtml"/>`).join('')
  const ncx = `<?xml version="1.0"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><navMap>${entries}<navLabel>${'<text/>'.repeat(200000)}</navLabel>${'</navPoint>'.repeat(depth)}</navMap></ncx>`
  const bytes = makeBook([['a.xhtml', xhtml(text)], ['toc.ncx', ncx]], `${PAGE}<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`, '<itemref idref="a"/>')
  const ms = await page.evaluate(async (bytes) => {
    const { openBook } = await import('/dist/src/index.js' as string)
    const start = performance.now()
    const book = await openBook(new Uint8Array(bytes))
    if (book.toc[0]?.label !== '0') throw new Error('table of contents not read')
    return performance.now() - start
  }, bytes)
  expect(ms).toBeLessThan(3000) // 13–23 s before; about 0.1–0.8 s (mostly the browser's XML parser) after
})

// The search for references back to a file (#refersTo) walked all the references found so far,
// for every reference: stylesheets that import many others took time growing with the 4th power of their number.
test('stylesheets that import many others are rewritten in time proportional to their size', async ({ page }) => {
  const k = 300 // each imports all those before it: 45 000 @imports, about 900 KB, no cycle
  const files: [string, string][] = []
  for (let i = 0; i < k; i++) files.push([`c${i}.css`, Array.from({ length: i }, (_, j) => `@import "c${j}.css";`).join('\n') + `\n.c${i} { color: red }`])
  const head = `<style>${files.map(([name]) => `@import "${name}";`).join('')}</style>`
  const manifest = PAGE + files.map(([name], i) => `<item id="s${i}" href="${name}" media-type="text/css"/>`).join('')
  const bytes = makeBook([['a.xhtml', xhtml(text, head)], ...files], manifest, '<itemref idref="a"/>')
  const ms = await page.evaluate(async (bytes) => {
    const { openBook } = await import('/dist/src/index.js' as string)
    const book = await openBook(new Uint8Array(bytes))
    const start = performance.now()
    await book.getUrl('a.xhtml')
    return performance.now() - start
  }, bytes)
  expect(ms).toBeLessThan(5000) // 3–13 s before, 0.2–0.6 s now, when run alone (the limit leaves room for the other tests running)
})
