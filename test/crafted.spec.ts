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

test('does not reach a server that the book names', async ({ page }) => {
  // A book could tell its author who reads it, and when. Connections are counted, not requests:
  // one made ahead of time (rel="preconnect") is not a request yet.
  let connections = 0
  const server = createServer((socket) => {
    connections++
    socket.on('error', () => {})
    socket.end('HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const head = `<link rel="preconnect" href="${url}/"/><link rel="stylesheet" href="${url}/style.css"/>`
  const body = `${text}<p style="background: url(${url}/background.png)"><img src="${url}/image.png" alt=""/></p>`
  await open(page, makeBook([['a.xhtml', xhtml(body, head)]], PAGE, '<itemref idref="a"/>'))
  await page.waitForTimeout(1000)
  server.close()
  expect(connections).toBe(0)
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
    const seen: unknown[] = []
    viewer.addEventListener('relocate', (e: CustomEvent) => seen.push([e.detail.index, e.detail.rtl]))
    await viewer.goLeft() // on to the text, not back past the start of the book
    viewer.setOptions({ writingMode: 'horizontal' }) // horizontal text that the reader asked for goes to the right
    await viewer.goLeft()
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
