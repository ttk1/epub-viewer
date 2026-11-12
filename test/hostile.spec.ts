// Regression tests for books that got around the protections, or kept the viewer from working.
import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:net'
import { content, makeBook, xhtml } from './helpers.ts'

const text = '<h1>Page</h1>' + '<p>The quick brown fox jumps over the lazy dog.</p>'.repeat(5)
const longText = '<h1>Page</h1>' + `<p>${'The quick brown fox jumps over the lazy dog. '.repeat(10)}</p>`.repeat(60)
const hack = '<script>top.document.body.dataset.hacked = "1"</script>'
const PAGE = '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/>'

/**
 * Opens the book in a viewer of its own (`window.viewer`) over the (empty) app; external links are
 * reported in `dataset.link`, and the relocate events kept in `window.relocates`.
 */
const open = (page: Page, bytes: number[], containerStyle = 'position: fixed; inset: 0') =>
  page.evaluate(
    async ([bytes, containerStyle]) => {
      const { EpubViewer, openBook } = await import('/dist/src/index.js' as string)
      const container = document.createElement('div')
      container.style.cssText = containerStyle
      document.body.append(container)
      const viewer = new EpubViewer(container)
      Object.assign(window, { viewer, relocates: [] })
      viewer.addEventListener('relocate', (e: CustomEvent) => (window as any).relocates.push(e.detail))
      viewer.addEventListener('link', (e: CustomEvent) => {
        e.preventDefault()
        document.body.dataset.link = e.detail.href
      })
      viewer.addEventListener('error', (e: CustomEvent) => (document.body.dataset.error = String(e.detail.error)))
      return viewer.open(await openBook(new Uint8Array(bytes))).then(() => '', String)
    },
    [bytes, containerStyle] as const,
  )

/** Turns the pages to the end of the book with next(), and gives the pages that were shown. */
const turnToEnd = (page: Page) =>
  page.evaluate(async () => {
    const viewer = (window as any).viewer
    let ended = false
    viewer.addEventListener('bookend', () => (ended = true))
    for (let turns = 0; !ended && turns < 100; turns++) await viewer.next()
    await new Promise((resolve) => setTimeout(resolve, 500)) // for the scroll events that may come later
    return (window as any).relocates.map((detail: { page: number }) => detail.page)
  })

/** A server that counts the connections made to it. */
async function listen(): Promise<{ url: string; connections: () => number }> {
  let connections = 0
  const server = createServer((socket) => {
    connections++
    socket.on('error', () => {})
    socket.end('HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, connections: () => (server.close(), connections) }
}

/** A book of one section, of the given type: "text/html", or XHTML that is (or is not) well-formed. */
function book(kind: 'html' | 'xhtml' | 'broken xhtml', body: string, head = ''): number[] {
  const file = kind === 'html' ? 'a.html' : 'a.xhtml'
  const source = kind === 'html' ? `<html><head><title>t</title>${head}</head><body>${body}</body></html>` : xhtml(body, head) + (kind === 'broken xhtml' ? '<br>' : '')
  return makeBook([[file, source]], `<item id="a" href="${file}" media-type="${kind === 'html' ? 'text/html' : 'application/xhtml+xml'}"/>`, '<itemref idref="a"/>')
}

/** Clicks an element of the page, without calling its methods (an element can have replaced them, as a <form> by its controls). */
async function clickOn(page: Page, id: string, button: 'left' | 'middle' = 'left'): Promise<void> {
  const box = await content(page).evaluate((id) => Element.prototype.getBoundingClientRect.call(document.getElementById(id)).toJSON(), id)
  const frame = (await page.locator('iframe[src^=blob]').boundingBox())!
  await page.mouse.click(frame.x + box.x + 5, frame.y + box.y + 5, { button })
}

test.beforeEach(async ({ page }) => {
  await page.goto('/app/')
})

// In an HTML document, <form>, <img>, <embed>, <iframe> and <object> are properties of the document by
// their names (and <object> by its id), over its own: `doc.documentElement` was the form, and only
// it was written out, with the CSP inside the body, where it does nothing (Firefox, WebKit).
for (const kind of ['html', 'broken xhtml'] as const) {
  for (const tag of ['form', 'object']) {
    test(`does not run scripts in a <${tag}> named after the root element (${kind})`, async ({ page }) => {
      await open(page, book(kind, `<${tag} name="documentElement">${hack}${text}</${tag}>`))
      await page.waitForTimeout(500)
      expect(await page.evaluate(() => document.body.dataset.hacked)).toBeUndefined()
    })
  }
}

// In the document shown, the viewer listened for clicks on the image instead of the root element:
// the browser followed the other links by itself (Chromium for HTML, Firefox for XHTML as well).
for (const kind of ['html', 'xhtml'] as const) {
  test(`intercepts the links of a page with an element named after a property of the document (${kind})`, async ({ page }) => {
    const { url, connections } = await listen()
    expect(await open(page, book(kind, `<img name="documentElement" alt=""/><p><a id="out" href="${url}/">Out</a></p>${text}`))).toBe('')
    await clickOn(page, 'out')
    await expect.poll(() => page.evaluate(() => document.body.dataset.link)).toBe(`${url}/`)
    expect(connections()).toBe(0)
    expect(await page.evaluate(() => document.body.dataset.error)).toBeUndefined()
  })
}

test('a document in which an element named after a property of the document is there only when read again is not shown', async ({ page }) => {
  // The <img> is text (inside <style>) when the document is rewritten, and an element in what is written out.
  const { url, connections } = await listen()
  const body = `<p>text</p><form><math><mtext></form><form><mglyph><style></math><img name="documentElement"><p><a id="out" href="${url}/">Out</a>`
  await open(page, book('html', body))
  expect(await content(page).evaluate(() => Document.prototype.querySelectorAll.call(document, 'img, a').length)).toBe(0)
  expect(connections()).toBe(0)
})

// The fragment of a URL is decoded, and the media type of a data: URL is the book's to choose: put
// into a <style> as they were, they ended it, and what came after them was read as elements, which
// had not been through the rewriting.
for (const [name, reference, type] of [
  ['the fragment of a URL', 'i.png#%3C/style%3E%3Cp%20id=%22injected%22%3Einjected%3C/p%3E%3Cstyle%3E', 'image/png'],
  ['the media type of a file', 'i.png', 'image/x&quot;)&gt;&lt;/style&gt;&lt;p id=&quot;injected&quot;&gt;injected&lt;/p&gt;&lt;style&gt;'],
]) {
  test(`${name} in a URL in CSS does not end the <style> that it is in`, async ({ page }) => {
    const manifest = `<item id="a" href="a.html" media-type="text/html"/><item id="i" href="i.png" media-type="${type}"/>`
    const source = `<html><head><title>t</title><style>h1 { background: url(${reference}) }</style></head><body>${text}</body></html>`
    expect(await open(page, makeBook([['a.html', source], ['i.png', 'not looked into']], manifest, '<itemref idref="a"/>'))).toBe('')
    expect(await content(page).evaluate(() => [document.getElementById('injected'), document.querySelectorAll('style').length])).toEqual([null, 2]) // the book's and the viewer's
    expect(await content(page).evaluate(() => getComputedStyle(document.querySelector('h1')!).backgroundImage)).toMatch(/^url\("(blob|data):/)
  })
}

// A file that can hold scripts gets a data: URL: a copy of the whole file for every reference to it.
test('a small book that refers to an SVG many times is not made into a document of hundreds of megabytes', async ({ page }) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><!--${'x'.repeat(300 * 1024)}--><rect width="10" height="10"/></svg>`
  const manifest = '<item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="i" href="i.svg" media-type="image/svg+xml"/>'
  const bytes = makeBook([['a.xhtml', xhtml(text + '<img src="i.svg" alt=""/>'.repeat(1000))], ['i.svg', svg]], manifest, '<itemref idref="a"/>')
  expect(bytes.length).toBeLessThan(2000)
  const size = await page.evaluate(async (bytes) => {
    const { openBook } = await import('/dist/src/index.js' as string)
    const book = await openBook(new Uint8Array(bytes))
    return (await (await fetch(await book.getUrl('a.xhtml'))).blob()).size
  }, bytes)
  expect(size).toBeLessThan(50 * 2 ** 20) // 410 MB before
})

// A <form> has its controls as properties by their names, over its own: `form.closest` was the
// <input>, and the click handler stopped with an error before it prevented the default. The browser
// followed the link around the form by itself, or opened it in a new tab (middle button).
for (const button of ['left', 'middle'] as const) {
  test(`intercepts a click on a form that has a control named "closest" in a link (${button} button)`, async ({ page, context }) => {
    const { url, connections } = await listen()
    const body = `${text}<div><a href="${url}/"><form id="form"><input type="hidden" name="closest"/>Out</form></a></div>`
    expect(await open(page, book('xhtml', body))).toBe('')
    let tabs = 0
    context.on('page', () => tabs++)
    await clickOn(page, 'form', button)
    await page.waitForTimeout(500)
    if (button === 'left') expect(await page.evaluate(() => document.body.dataset.link)).toBe(`${url}/`)
    expect(tabs).toBe(0)
    expect(connections()).toBe(0)
  })
}

// The app is given the URL that the browser would go to: as the book wrote it, "http:\\host\" was
// not what a check of the app (e.g. for the start "http://") would take it for. Nor does a URL
// that is not one make window.open() throw.
for (const [href, expected] of [
  ['http:\\\\127.0.0.1:1\\a', 'http://127.0.0.1:1/a'],
  ['HTTP://127.0.0.1:1/b', 'http://127.0.0.1:1/b'],
  ['http://127.&#10;0.0.1:1/c', 'http://127.0.0.1:1/c'],
  ['http://[::1', undefined],
]) {
  test(`reports the link ${JSON.stringify(href)} as ${expected ?? 'nothing'}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await open(page, makeBook([['a.xhtml', xhtml(`<p><a id="out" href="${href}">Out</a></p>${text}`)]], PAGE, '<itemref idref="a"/>'))
    await content(page).locator('#out').click()
    await page.waitForTimeout(300)
    expect(await page.evaluate(() => document.body.dataset.link)).toBe(expected)
    expect(errors).toEqual([])
  })
}

// The page turns of reflowable text are scrolls of the document, which the book could make smooth:
// every step of the scroll was taken for a page (Firefox, WebKit), and the pages went back and forth.
// And a CSP of the book's own stopped the styles of the viewer: the text was not split into pages.
for (const [name, head] of [
  ['makes scrolling smooth', '<style>html:root { scroll-behavior: smooth !important }</style>'],
  ['has a CSP of its own', `<meta http-equiv="Content-Security-Policy" content="style-src 'none'"/>`],
]) {
  test(`turns the pages of a book that ${name} one by one`, async ({ page }) => {
    await open(page, makeBook([['a.xhtml', xhtml(longText, head)]], PAGE, '<itemref idref="a"/>'))
    // (The first page can be reported twice, when the frame is laid out again as it is shown.)
    const pages = (await turnToEnd(page)).filter((p: number, i: number, all: number[]) => p !== all[i - 1])
    expect(pages.length).toBeGreaterThan(5)
    expect(pages).toEqual(pages.map((_: number, i: number) => i))
  })
}

// In a document with dir="rtl", the browser scrolls to the left of the start: the page number was negative.
test('does not report a page before the first when the browser scrolls a document that goes from right to left', async ({ page }) => {
  const source = xhtml(`${longText}<p><a id="late" href="#x">late</a></p>`).replace('<html ', '<html dir="rtl" ')
  await open(page, makeBook([['a.xhtml', source]], PAGE, '<itemref idref="a"/>'))
  await content(page).evaluate(() => document.getElementById('late')!.focus()) // the browser scrolls the link into view
  await page.waitForTimeout(500)
  const pages = await page.evaluate(() => (window as any).relocates.map((detail: { page: number; progress: number; fraction: number }) => [detail.page, detail.progress, detail.fraction]))
  for (const [p, progress, fraction] of pages) {
    expect(p).toBeGreaterThanOrEqual(0)
    expect(progress).toBeGreaterThanOrEqual(0)
    expect(fraction).toBeGreaterThanOrEqual(0)
  }
})

test('a section with autofocus does not take the focus from the host page, nor scroll it', async ({ page }) => {
  const manifest = `${PAGE}<item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>`
  const bytes = makeBook([['a.xhtml', xhtml(text)], ['b.xhtml', xhtml('<h1>B</h1><p><input autofocus="autofocus"/></p>')]], manifest, '<itemref idref="a"/><itemref idref="b"/>')
  await page.evaluate(() => {
    const input = document.createElement('input')
    input.id = 'host-input'
    const room = document.createElement('div')
    room.style.height = '3000px' // the viewer is below, out of sight
    document.body.prepend(input, room)
  })
  await open(page, bytes, 'width: 600px; height: 400px')
  await page.evaluate(() => scrollTo(0, 0))
  await page.locator('#host-input').focus()
  await page.evaluate(() => (window as any).viewer.goTo({ index: 1, progress: 0 }))
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => [document.activeElement!.id, scrollY])).toEqual(['host-input', 0]) // WebKit: the frame, 3177
})

test('the arrow keys turn the pages of a book that is editable', async ({ page }) => {
  await open(page, makeBook([['a.xhtml', xhtml(longText).replace('<body>', '<body contenteditable="true">')]], PAGE, '<itemref idref="a"/>'))
  const frame = (await page.locator('iframe[src^=blob]').boundingBox())!
  await page.mouse.click(frame.x + frame.width / 2, frame.y + frame.height / 2) // into the text
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.evaluate(() => (window as any).viewer.location.progress)).toBeGreaterThan(0)
})

// The table of contents was given to replaceChildren() as a list of arguments, which has a limit:
// open() failed with the book already shown (and the table of contents of the book before).
test('EpubReader opens a book with a table of contents of 200 000 entries', async ({ page }) => {
  const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>c</title></head><body><nav epub:type="toc"><ol>${'<li><a href="a.xhtml">x</a></li>'.repeat(200000)}</ol></nav></body></html>`
  const manifest = `${PAGE}<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>`
  const bytes = makeBook([['a.xhtml', xhtml(text)], ['nav.xhtml', nav]], manifest, '<itemref idref="a"/>')
  const result = await page.evaluate(async (bytes) => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const root = document.getElementById('reader')!
    const reader = new EpubReader(root, { storage: null })
    const error = await reader.open(new Uint8Array(bytes)).then(() => '', String)
    return { error, entries: root.querySelectorAll('.toc-list button').length }
  }, bytes)
  expect(result).toEqual({ error: '', entries: 200000 }) // Chromium: "Maximum call stack size exceeded"
})

// Each chapter refers to the next by src (as an image, or a frame, which the CSP closes anyway):
// the first chapter was not ready until all of them had been rewritten.
test('a document that a section refers to by src is not rewritten for it', async ({ page }) => {
  const n = 300
  const files: [string, string][] = Array.from({ length: n }, (_, i) => [`c${i}.xhtml`, xhtml(`${text}<img src="c${i + 1}.xhtml" alt=""/>`)])
  const manifest = files.map(([name], i) => `<item id="c${i}" href="${name}" media-type="application/xhtml+xml"/>`).join('')
  const bytes = makeBook(files, manifest, files.map((_, i) => `<itemref idref="c${i}"/>`).join(''))
  const src = await page.evaluate(async (bytes) => {
    const { openBook } = await import('/dist/src/index.js' as string)
    const book = await openBook(new Uint8Array(bytes))
    return (await (await fetch(await book.getUrl('c0.xhtml'))).text()).match(/<img src="([^"]*)"/)![1]
  }, bytes)
  expect(src).toBe('c1.xhtml')
})

// Known ways of taking the frame elsewhere are closed; for others, the frame is emptied when it
// loads again. A page that does not finish loading never does: it was shown as long as it loaded.
test('empties the frame when the book takes it to a page that does not finish loading', async ({ page }) => {
  const server = createServer((socket) => {
    socket.on('error', () => {})
    // And no end. Enough of it for WebKit to show it (it waits for more before it does).
    socket.write(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<h1>Elsewhere</h1>${' '.repeat(100000)}`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`
  await open(page, makeBook([['a.xhtml', xhtml(text)]], PAGE, '<itemref idref="a"/>'))
  // As the book would, by a way that is not known.
  await page.evaluate((url) => ((document.querySelector('iframe[src^=blob]') as HTMLIFrameElement).contentWindow!.location.href = url), url)
  await expect.poll(() => page.evaluate(() => document.body.dataset.error)).toContain('tried to leave its page')
  await expect.poll(() => page.frames().some((frame) => frame.url() === url)).toBe(false)
  server.close()
})
