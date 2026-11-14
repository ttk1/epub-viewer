// The API as an embedding app uses it: a viewer or a reader made by the test itself.
import { expect, test, type Page } from '@playwright/test'
import { content, evaluate, heading, click, press, setting } from './helpers.ts'

test('a click on the middle of the page is reported as a tap, one on the side turns the page', async ({ page }) => {
  await page.goto('/app/')
  // A viewer of its own, over the (empty) app.
  await page.evaluate(async () => {
    const { EpubViewer, openBook } = await import('/dist/src/index.js' as string)
    const container = document.createElement('div')
    container.style.cssText = 'position: fixed; inset: 0'
    document.body.append(container)
    const viewer = new EpubViewer(container, { fontSize: 40 })
    viewer.addEventListener('relocate', (e: CustomEvent) => (document.title = `page ${e.detail.page + 1}`))
    viewer.addEventListener('tap', (e: CustomEvent) => (document.body.dataset.taps = `${document.body.dataset.taps ?? ''} ${e.detail.x.toFixed(2)}`))
    await viewer.open(await openBook('/samples/general.epub'))
  })
  await expect(page).toHaveTitle('page 1')
  await click(page, 640, 700)
  await expect(page).toHaveTitle('page 1')
  await click(page, 1152, 700)
  await expect(page).toHaveTitle('page 2')
  expect(await page.evaluate(() => document.body.dataset.taps)).toBe(' 0.50') // only the first click
})

test('goTo({ fraction }) moves to a position in the whole book, as reported by relocate', async ({ page }) => {
  await page.goto('/app/')
  const results = await page.evaluate(async () => {
    const { EpubViewer, openBook } = await import('/dist/src/index.js' as string)
    const container = document.createElement('div')
    container.style.cssText = 'position: fixed; inset: 0'
    document.body.append(container)
    const viewer = new EpubViewer(container, { fontSize: 40 })
    let detail: any
    viewer.addEventListener('relocate', (e: CustomEvent) => (detail = e.detail))
    const at = async (fraction: number) => {
      await viewer.goTo({ fraction })
      return { index: detail.index, page: detail.page, pages: detail.pages, fraction: detail.fraction, indices: detail.indices }
    }
    await viewer.open(await openBook('/samples/nepub.epub'))
    const text = { start: await at(0), middle: await at(0.5), end: await at(1) }
    // Every page is found again from the fraction that it reports.
    const mismatches: unknown[] = []
    for (let i = 0; i < 40; i++) {
      await viewer.next()
      const reported = { ...detail }
      const found = await at(reported.fraction)
      if (found.index !== reported.index || found.page !== reported.page) mismatches.push([reported, found])
    }
    await viewer.open(await openBook('/samples/fixed.epub'))
    const pages = { start: await at(0), middle: await at(0.5), end: await at(1) }
    // The same for pages, also where the fraction is not an exact number (7 / 25).
    viewer.setOptions({ spread: 'never' })
    await viewer.open(await openBook('/samples/fixed-plain.epub'))
    for (let i = 0; i < 25; i++) {
      await viewer.goTo({ index: i, progress: 0 })
      const reported = { ...detail }
      const found = await at(reported.fraction)
      if (found.index !== reported.index) mismatches.push([reported, found])
    }
    return { text, pages, mismatches }
  })
  expect(results.text.start).toMatchObject({ index: 0, page: 0 })
  expect(results.text.middle.index).toBe(1) // the second of three episodes of the same length
  expect(results.text.middle.fraction).toBeCloseTo(0.5, 1)
  expect(results.text.end).toMatchObject({ index: 2, fraction: 1 })
  expect(results.text.end.page).toBe(results.text.end.pages - 1)
  expect(results.mismatches).toEqual([])
  expect(results.pages.start).toMatchObject({ index: 0 })
  expect(results.text.middle.indices).toEqual([1])
  // The spread of pages 2 and 3, of 6. Each page of a fixed-layout book is a section of one page.
  expect(results.pages.middle).toMatchObject({ index: 1, indices: [1, 2], page: 0, pages: 1, fraction: 0.5 })
  expect(results.pages.end).toMatchObject({ index: 5, fraction: 1 })
})

/** Runs `use` in the page with a viewer of its own over the (empty) app, and the library. */
const withViewer = <T>(page: Page, use: (viewer: any, lib: any, container: HTMLElement) => Promise<T>) =>
  page.evaluate(async (use) => {
    const lib = await import('/dist/src/index.js' as string)
    const container = document.createElement('div')
    container.style.cssText = 'position: fixed; inset: 0'
    document.body.append(container)
    return new Function(`return (${use})`)()(new lib.EpubViewer(container, { fontSize: 40 }), lib, container)
  }, use.toString())

test('a book opened while another is still loading is shown at the place asked for', async ({ page }) => {
  await page.goto('/app/')
  const location = await withViewer(page, async (viewer, { openBook }) => {
    const [first, second] = await Promise.all([openBook('/samples/general.epub'), openBook('/samples/nepub.epub')])
    await Promise.all([viewer.open(first), viewer.open(second, { index: 2, progress: 0 })])
    return { ...viewer.location, book: viewer.book === second }
  })
  expect(location).toEqual({ index: 2, progress: 0, book: true })
})

test('a move asked for while the book is still opening is not replaced by the start of the book', async ({ page }) => {
  await page.goto('/app/')
  const location = await withViewer(page, async (viewer, { openBook }) => {
    const book = await openBook('/samples/nepub.epub')
    await Promise.all([viewer.open(book), viewer.goTo({ index: 2, progress: 0 })])
    await new Promise((resolve) => setTimeout(resolve, 300))
    return viewer.location
  })
  expect(location).toEqual({ index: 2, progress: 0 })
})

test('of two navigations, the one asked for last wins, whichever is ready first', async ({ page }) => {
  await page.goto('/app/')
  const index = await withViewer(page, async (viewer, { openBook }) => {
    const book = await openBook('/samples/nepub.epub')
    await viewer.open(book)
    // The files of the first section asked for take longer to get ready.
    const getUrl = book.getUrl.bind(book)
    book.getUrl = async (path: string) => {
      if (path === book.sections[1].href) await new Promise((resolve) => setTimeout(resolve, 300))
      return getUrl(path)
    }
    await Promise.all([viewer.goTo({ index: 1, progress: 0 }), viewer.goTo({ index: 2, progress: 0 })])
    await new Promise((resolve) => setTimeout(resolve, 500))
    return viewer.location.index
  })
  expect(index).toBe(2)
})

test('a change of options or of size while a fixed-layout page is loading does not cancel the page turn', async ({ page }) => {
  await page.goto('/app/')
  const index = await withViewer(page, async (viewer, { openBook, themes }) => {
    await viewer.open(await openBook('/samples/fixed.epub'))
    const turned = viewer.next()
    viewer.setOptions({ theme: themes.dark })
    await turned
    return viewer.location.index
  })
  expect(index).toBe(1)
})

test('keeps the position while the container is hidden', async ({ page }) => {
  await page.goto('/app/')
  const pages = await withViewer(page, async (viewer, { openBook }, container) => {
    await viewer.open(await openBook('/samples/nepub.epub'))
    const seen: number[] = []
    viewer.addEventListener('relocate', (e: CustomEvent) => seen.push(e.detail.page))
    for (let i = 0; i < 3; i++) await viewer.next()
    const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    container.style.display = 'none' // e.g. a tab of the app that is not shown
    await frames()
    container.style.display = ''
    await frames()
    return seen
  })
  expect(pages.every((page) => page > 0)).toBe(true) // never back at the first page
  expect(pages[pages.length - 1]).toBe(3)
})

test('a book opened in a hidden container is shown as asked once the container is shown', async ({ page }) => {
  await page.goto('/app/')
  const result = await withViewer(page, async (viewer, { openBook }, container) => {
    const book = await openBook('/samples/nepub.epub') // vertical text
    container.style.display = 'none' // e.g. a tab of the app that is not shown yet
    let detail: any
    const hidden: unknown[] = []
    viewer.addEventListener('relocate', (e: CustomEvent) => {
      detail = e.detail
      if (container.style.display === 'none') hidden.push(e.detail.page, e.detail.pages, e.detail.fraction)
    })
    await viewer.open(book, { index: 1, progress: 0.5 })
    container.style.display = ''
    await new Promise((resolve) => setTimeout(resolve, 1000))
    viewer.setOptions({}) // a re-layout as well
    return { hidden, index: detail.index, pages: detail.pages, progress: viewer.location.progress }
  })
  expect(result.hidden.every(Number.isFinite)).toBe(true) // no NaN or Infinity in relocate
  expect(result.index).toBe(1)
  expect(result.pages).toBeGreaterThan(5) // laid out as vertical text, in pages
  expect(result.progress).toBeCloseTo(0.5, 1)
})

test('a book opened at a place that it does not have, while a page turn of the book before is loading, is shown from its start', async ({ page }) => {
  await page.goto('/app/')
  const result = await withViewer(page, async (viewer, { openBook }) => {
    const [first, second] = await Promise.all([openBook('/samples/general.epub'), openBook('/samples/nepub.epub')])
    await viewer.open(first)
    const turning = viewer.goTo({ index: 2, progress: 0 }) // still loading when the next book is opened
    await viewer.open(second, { index: 99, progress: 0 }) // e.g. a position saved for another edition
    await turning
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { book: viewer.book === second, location: viewer.location }
  })
  expect(result).toEqual({ book: true, location: { index: 0, progress: 0 } })
})

test('shows nothing of a page that the frame has gone to by itself, and reports it', async ({ page }) => {
  await page.goto('/app/')
  const result = await withViewer(page, async (viewer, { openBook }, container) => {
    await viewer.open(await openBook('/samples/general.epub'))
    const errors: string[] = []
    viewer.addEventListener('error', (e: CustomEvent) => errors.push(String(e.detail.error)))
    // What a book could do in a way that is not known yet.
    const frame = container.querySelector('iframe')!
    frame.contentWindow!.location.href = '/app/style.css'
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return { errors, url: container.querySelector('iframe')!.contentDocument?.URL }
  })
  expect(result.errors).toHaveLength(1)
  expect(result.url).toBe('about:blank')
})

test('after the frame has gone away by itself, the position is kept and the section can be shown again', async ({ page }) => {
  await page.goto('/app/')
  const result = await withViewer(page, async (viewer, { openBook }, container) => {
    await viewer.open(await openBook('/samples/general.epub'))
    await viewer.next()
    await viewer.next()
    const before = viewer.location
    container.querySelector('iframe')!.contentWindow!.location.href = '/app/style.css'
    await new Promise((resolve) => setTimeout(resolve, 1000))
    viewer.setOptions({ fontSize: 30 }) // a re-layout of the empty page must not be taken for the first page
    const kept = JSON.stringify(viewer.location) === JSON.stringify(before)
    await viewer.goTo(before)
    return { kept, heading: container.querySelector('iframe')!.contentDocument!.querySelector('h1')?.textContent, page: viewer.location.progress > 0 }
  })
  expect(result).toEqual({ kept: true, heading: 'Chapter 1', page: true })
})

test('a viewer destroyed while a page is loading does not leave the caller waiting', async ({ page }) => {
  await page.goto('/app/')
  const result = await withViewer(page, async (viewer, { openBook }) => {
    const book = await openBook('/samples/nepub.epub')
    const opened = viewer.open(book)
    await book.getUrl(book.sections[0].href)
    await new Promise((resolve) => setTimeout(resolve, 0)) // the frame has begun to load
    viewer.destroy()
    return Promise.race([opened.then(() => 'settled'), new Promise((resolve) => setTimeout(() => resolve('still waiting'), 2000))])
  })
  expect(result).toBe('settled')
})

test('a position that is not a number is taken as the start of the section', async ({ page }) => {
  await page.goto('/app/')
  const locations = await withViewer(page, async (viewer, { openBook }) => {
    await viewer.open(await openBook('/samples/nepub.epub'))
    const seen = []
    for (const target of [{ index: 0, progress: NaN }, { fraction: NaN }, { index: 0, progress: 'half' }]) {
      await viewer.goTo({ index: 0, progress: 0.5 })
      await viewer.goTo(target)
      seen.push(viewer.location.progress)
    }
    await viewer.next() // and page turns go on from there, not to the next section
    return [...seen, viewer.location.index, viewer.location.progress > 0]
  })
  expect(locations).toEqual([0, 0, 0, 0, true])
})

test('with click: false, clicks do not turn pages but links still work', async ({ page }) => {
  await page.goto('/app/')
  // A viewer of its own, over the (empty) app.
  await page.evaluate(async () => {
    const { EpubViewer, openBook } = await import('/dist/src/index.js' as string)
    const container = document.createElement('div')
    container.style.cssText = 'position: fixed; inset: 0'
    document.body.append(container)
    const viewer = new EpubViewer(container, { click: false })
    viewer.addEventListener('relocate', (e: CustomEvent) => (document.title = `page ${e.detail.page + 1}`))
    viewer.addEventListener('tap', (e: CustomEvent) => (document.body.dataset.tap = e.detail.x.toFixed(2)))
    await viewer.open(await openBook('/samples/general.epub'))
  })
  await expect(page).toHaveTitle('page 1')
  await click(page, 1152, 600) // the right side
  await expect(page).toHaveTitle('page 1')
  // The click is passed on instead, with its position across the page, for the app to act on.
  expect(await page.evaluate(() => document.body.dataset.tap)).toBe('0.90')
  await content(page).locator('#to-2-1').click()
  await expect.poll(() => heading(page)).toBe('Chapter 2')
})

test('EpubReader.setSettings() changes and saves settings like the toolbar does', async ({ page }) => {
  await page.goto('/app/')
  // A reader of its own, in place of the app's.
  const settings = await page.evaluate(async () => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const root = document.createElement('div')
    root.style.height = '100vh'
    document.body.replaceChildren(root)
    const reader = new EpubReader(root, { storageKey: 'test', settings: { font: 'gothic' } })
    reader.setSettings({ theme: 'sepia', fontSize: 30 })
    return { ...reader.settings, viewerFontSize: reader.viewer.options.fontSize, saved: localStorage.getItem('test:settings') }
  })
  expect(settings).toMatchObject({ theme: 'sepia', font: 'gothic', fontSize: 30, viewerFontSize: 30 })
  expect(JSON.parse(settings.saved)).toEqual({ theme: 'sepia', fontSize: 30 })
  await expect(page.locator('input[name=theme]:checked')).toHaveValue('sepia')
  await expect(page.locator('.font-size')).toHaveText('30')

  // The app may hide the toolbar (e.g. on a tap); the page then takes its room.
  const height = () => page.locator('.viewer').evaluate((viewer) => viewer.getBoundingClientRect().height)
  expect(await height()).toBeLessThan(720)
  await page.locator('.toolbar').evaluate((toolbar) => ((toolbar as HTMLElement).hidden = true))
  await expect(page.locator('.toolbar')).toBeHidden()
  expect(await height()).toBe(720)
})

test('EpubReader keeps settings and positions in the storage that it is given', async ({ page }) => {
  await page.goto('/app/')
  const result = await page.evaluate(async () => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const root = document.createElement('div')
    root.style.height = '100vh'
    document.body.replaceChildren(root)
    // What a site would keep on its server: here, what it has for this user, and what the reader writes.
    const saved = new Map(Object.entries({ 'site:settings': '{"theme":"sepia"}', 'site:position:book-1': '{"index":1,"progress":0}' }))
    const written: string[] = []
    const storage = {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value)
        written.push(key)
      },
    }
    const reader = new EpubReader(root, { storage, storageKey: 'site' })
    await reader.open('/samples/nepub.epub', { key: 'book-1' })
    const opened = { theme: reader.settings.theme, index: reader.viewer.location.index }
    reader.setSettings({ fontSize: 30 })
    await reader.viewer.next()
    return { opened, written: [...new Set(written)].sort(), settings: saved.get('site:settings'), local: localStorage.length }
  })
  expect(result.opened).toEqual({ theme: 'sepia', index: 1 }) // read from the storage
  expect(result.written).toEqual(['site:position:book-1', 'site:settings'])
  expect(JSON.parse(result.settings!)).toEqual({ theme: 'sepia', fontSize: 30 })
  expect(result.local).toBe(0) // nothing goes to localStorage then
})

test('EpubReader works with saved things that are not what it would have written', async ({ page }) => {
  await page.goto('/app/')
  const result = await page.evaluate(async () => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const root = document.createElement('div')
    root.style.height = '100vh'
    document.body.replaceChildren(root)
    // A theme that this version does not know, and a position that is not one.
    const saved: Record<string, string> = { 'x:settings': '{"theme":"neon","fontSize":30}', 'x:position:book': '5' }
    const storage = { getItem: (key: string) => saved[key] ?? null, setItem: () => {} }
    const reader = new EpubReader(root, { storage, storageKey: 'x' })
    await reader.open('/samples/nepub.epub', { key: 'book' })
    return { location: reader.viewer.location, fontSize: reader.settings.fontSize, background: getComputedStyle(root).backgroundColor }
  })
  expect(result.location).toEqual({ index: 0, progress: 0 })
  expect(result.fontSize).toBe(30) // what can be used is used
  expect(result.background).toBe('rgb(255, 255, 255)') // the light theme
})

test('EpubReader does not use saved settings of the wrong kind', async ({ page }) => {
  await page.goto('/app/')
  await page.evaluate(async () => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const root = document.createElement('div')
    root.style.height = '100vh'
    document.body.replaceChildren(root)
    new EpubReader(root, { storage: { getItem: () => '{"fontSize":"large","maxWidth":800}', setItem: () => {} }, settings: { fontSize: 30 } })
  })
  await page.locator('.settings summary').click()
  await expect(page.locator('.font-size')).toHaveText('30') // the size given by the app, not what was saved
  await page.locator('.font-up').click()
  await expect(page.locator('.font-size')).toHaveText('36')
  await expect(page.locator('input[name=maxWidth]:checked')).toHaveValue('800') // what can be used is used
})

test('a destroyed viewer leaves nothing on its container', async ({ page }) => {
  await page.goto('/app/')
  const left = await withViewer(page, async (viewer, { openBook, themes }, container) => {
    viewer.setOptions({ theme: themes.dark })
    await viewer.open(await openBook('/samples/general.epub'))
    viewer.destroy()
    return { style: container.getAttribute('style'), children: container.childElementCount }
  })
  expect(left).toEqual({ style: 'position: fixed; inset: 0px;', children: 0 })
})

test('keys of the app turn pages also after a click on the page, as in the README', async ({ page }) => {
  await page.goto('/app/')
  await page.evaluate(async () => {
    const { EpubViewer, openBook } = await import('/dist/src/index.js' as string)
    const container = document.createElement('div')
    container.style.cssText = 'position: fixed; inset: 0'
    document.body.append(container)
    const viewer = new EpubViewer(container, { keyboard: false, click: false })
    viewer.addEventListener('relocate', (e: CustomEvent) => (document.title = `page ${e.detail.page + 1}`))
    // The example of the README.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'j') viewer.next()
    }
    window.addEventListener('keydown', onKey)
    viewer.addEventListener('sectionload', (e: CustomEvent) => e.detail.doc.defaultView.addEventListener('keydown', onKey))
    await viewer.open(await openBook('/samples/general.epub'))
  })
  await page.keyboard.press('j')
  await expect(page).toHaveTitle('page 2')
  await page.mouse.click(640, 400) // the focus goes into the page of the book
  await page.keyboard.press('j')
  await expect(page).toHaveTitle('page 3')
})

test('EpubReader does not take a saved theme name for a theme because objects have something by that name', async ({ page }) => {
  await page.goto('/app/')
  const background = await page.evaluate(async () => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const root = document.createElement('div')
    root.style.height = '100vh'
    document.body.replaceChildren(root)
    new EpubReader(root, { storage: { getItem: () => '{"theme":"constructor"}', setItem: () => {} } })
    return getComputedStyle(root).backgroundColor
  })
  expect(background).toBe('rgb(255, 255, 255)') // the light theme
})

test('controls that the app adds to the toolbar keep the focus that they are given', async ({ page }) => {
  await page.goto('/app/?url=/samples/nepub.epub')
  await expect(page.locator('.progress')).toHaveText(/^1 \//)
  await page.evaluate(() => {
    document.querySelector('.toolbar')!.append(Object.assign(document.createElement('input'), { type: 'search', placeholder: '検索' }))
  })
  await page.locator('.toolbar input[type=search]').click()
  await page.keyboard.type('abc ')
  await expect(page.locator('.toolbar input[type=search]')).toBeFocused()
  await expect(page.locator('.toolbar input[type=search]')).toHaveValue('abc ') // the keys go to the field, not to page turns
  await expect(page.locator('.progress')).toHaveText(/^1 \//)
})

// A page with a Content-Security-Policy of its own, and what open() comes to on it: 'shown', the
// message that it rejects with, or 'pending'. The viewer is left in window.viewer.
async function openUnderPolicy(page: Page, csp: string): Promise<{ outcome: string; frames: number }> {
  await page.route('**/site.html', (route) =>
    route.fulfill({ contentType: 'text/html', headers: { 'content-security-policy': csp }, body: '<!doctype html><meta charset="utf-8"><body style="margin: 0"><div id="viewer" style="height: 100vh"></div>' }),
  )
  await page.goto('/site.html')
  return page.evaluate(async () => {
    const { EpubViewer, openBook } = await import('/dist/src/index.js' as string)
    const viewer = ((window as any).viewer = new EpubViewer(document.getElementById('viewer')!))
    const book = await openBook('/samples/nepub.epub')
    const outcome = await Promise.race([
      viewer.open(book).then(() => 'shown', (error: Error) => error.message),
      new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 5000)),
    ])
    return { outcome, frames: document.querySelectorAll('iframe').length }
  })
}
const POLICY = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' blob:; img-src 'self' blob: data:; font-src 'self' blob: data:"

test('open() rejects when the Content-Security-Policy of the host page does not allow the frames of the book', async ({ page }) => {
  // It used to wait for good: the frame never loads, and the site could not tell its user.
  // With frame-src given, and with default-src standing in for it.
  for (const csp of [`${POLICY}; frame-src 'none'`, POLICY]) {
    const { outcome, frames } = await openUnderPolicy(page, csp)
    expect(outcome).toContain('Content-Security-Policy')
    expect(frames).toBe(1) // the frame that could not be loaded is not left behind
  }
})

test("open() comes to an end under frame-ancestors 'none'", async ({ page, browserName }) => {
  // WebKit applies the directive to the frame of the book as well (it takes the policy of the
  // page that made the blob: URL), and so does not show it: see the README.
  const { outcome } = await openUnderPolicy(page, `${POLICY}; frame-src blob:; frame-ancestors 'none'`)
  if (browserName === 'webkit') expect(outcome).toContain('Content-Security-Policy')
  else expect(outcome).toBe('shown')
})

test('a move that the Content-Security-Policy of the host page stops rejects, and the page before it stays', async ({ page }) => {
  expect((await openUnderPolicy(page, `${POLICY}; frame-src blob:`)).outcome).toBe('shown')
  const result = await page.evaluate(async () => {
    const viewer = (window as any).viewer
    // A policy can be made stricter while the page is open.
    document.head.append(Object.assign(document.createElement('meta'), { httpEquiv: 'Content-Security-Policy', content: "frame-src 'none'" }))
    const outcome = await Promise.race([
      viewer.goTo({ index: 1, progress: 0 }).then(() => 'shown', (error: Error) => error.message),
      new Promise<string>((resolve) => setTimeout(() => resolve('pending'), 5000)),
    ])
    const index = viewer.location.index
    await viewer.next() // pages of the section shown can still be turned
    return { outcome, index, frames: document.querySelectorAll('iframe').length, page: viewer.location.progress > 0 }
  })
  expect(result.outcome).toContain('Content-Security-Policy')
  expect(result).toMatchObject({ index: 0, frames: 1, page: true })
})

test('a site of one EPUB per episode can be made with EpubReader alone', async ({ page }) => {
  // What such a site does with the reader, under the Content-Security-Policy that it sends: its own
  // link and status in the toolbar, its own title, a key of its own for each episode, the next and
  // the previous episode at the ends of the book, and the saved positions of other episodes removed.
  const csp =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' blob:; img-src 'self' blob: data:; font-src 'self' blob: data:; media-src blob: data:; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'self'"
  // A page of its own: on the page of the app, the viewer of the app would take the keys first.
  await page.route('**/site.html', (route) =>
    route.fulfill({ contentType: 'text/html', headers: { 'content-security-policy': csp }, body: '<!doctype html><meta charset="utf-8"><body style="margin: 0"><div id="reader" style="height: 100vh"></div>' }),
  )
  await page.goto('/site.html')
  await page.evaluate(async () => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const reader = new EpubReader(document.getElementById('reader')!, { storageKey: 'site' })
    const title = reader.toolbar.querySelector('.title')!
    const status = document.createElement('span')
    status.className = 'status'
    title.after(status)
    reader.toolbar.prepend(Object.assign(document.createElement('a'), { href: '/', textContent: 'トップ' }))
    let current = 0
    let loading = false
    async function show(episode: number, location?: object) {
      status.textContent = '読み込み中…'
      const response = await fetch(`/samples/episode-${episode}.epub`)
      if (!response.ok) throw new Error('最新話です')
      const book = await reader.open(await response.blob(), { key: `novel:${episode}`, location })
      current = episode
      title.textContent = `${book.metadata.title}　${book.toc[0]?.label ?? ''}`
      // Only the position of the episode being read is kept.
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('site:position:novel:') && key !== `site:position:novel:${episode}`) localStorage.removeItem(key)
      }
      status.textContent = ''
    }
    async function turn(forward: boolean) {
      if (loading) return
      loading = true
      await show(current + (forward ? 1 : -1), forward ? { index: 0, progress: 0 } : { index: -1, progress: 1 }).catch((error) => (status.textContent = error.message))
      loading = false
    }
    reader.viewer.addEventListener('bookend', () => void turn(true))
    reader.viewer.addEventListener('bookstart', () => void turn(false))
    ;(window as any).reader = reader
    await show(1)
  })
  const reader = (use: string) => page.evaluate(`(async () => { const { viewer } = window.reader; return ${use} })()`)
  await expect(page.locator('.title')).toHaveText('連載サンプル　第1話　サンプル')
  await expect(page.locator('.toolbar > a')).toHaveText('トップ')
  await expect(page.locator('.toc')).toBeHidden() // an episode has a single entry: no table of contents to show

  // Past the last page: the next episode, from its start.
  await reader('viewer.goTo({ index: -1, progress: 1 })')
  await press(page, 'ArrowLeft')
  await expect(page.locator('.title')).toHaveText('連載サンプル　第2話　サンプル')
  await expect(page.locator('.pages')).toHaveText(/^1 \//)
  // Back past its first page: the episode before, at its last page.
  await press(page, 'ArrowRight')
  await expect(page.locator('.title')).toHaveText('連載サンプル　第1話　サンプル')
  expect(await reader('viewer.location.progress > 0')).toBe(true)
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('position')))).toEqual(['site:position:novel:1'])

  // Past the last episode: the reader stays where it is, and the site says so.
  await reader('viewer.goTo({ fraction: 1 })')
  for (const episode of [2, 3]) {
    await press(page, 'ArrowLeft')
    await expect(page.locator('.title')).toHaveText(`連載サンプル　第${episode}話　サンプル`)
    await reader('viewer.goTo({ fraction: 1 })')
  }
  await press(page, 'ArrowLeft')
  await expect(page.locator('.status')).toHaveText('最新話です')
  await expect(page.locator('.title')).toHaveText('連載サンプル　第3話　サンプル')
  await press(page, 'ArrowRight') // and still turns pages
  expect(await reader('viewer.location.progress < 1 && viewer.location.index >= 0')).toBe(true)
})

test('EpubReader shows the book opened last, even when an earlier one takes longer to load', async ({ page }) => {
  await page.goto('/app/')
  const titles = await page.evaluate(async () => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const root = document.createElement('div')
    root.style.height = '100vh'
    document.body.replaceChildren(root)
    const reader = new EpubReader(root, { storage: null })
    const episode = await (await fetch('/samples/episode-1.epub')).blob()
    // The first one has to be fetched; the second is at hand and is ready sooner.
    const books = await Promise.all([reader.open('/samples/nepub.epub'), reader.open(episode)])
    return [...books.map((book) => book.metadata.title), reader.book!.metadata.title]
  })
  expect(titles).toEqual(['連載サンプル', '連載サンプル', '連載サンプル']) // both calls give the book that is shown
  await expect(page.locator('.title')).toHaveText('連載サンプル')
  await expect.poll(() => heading(page)).toBe('第1話　サンプル')
})

test('EpubReader offers the choices and the font sizes that the app gives it', async ({ page }) => {
  await page.goto('/app/')
  await page.evaluate(async () => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const root = document.createElement('div')
    root.style.height = '100vh'
    document.body.replaceChildren(root)
    const reader = new EpubReader(root, {
      storageKey: 'choices',
      settings: { fontSize: 22 },
      choices: { margin: [[0, 'なし'], [200, '<b>広い</b>']], maxWidth: [] },
      fontSizeSteps: { max: 24, step: 1.01 },
    })
    ;(window as any).reader = reader
    await reader.open('/samples/nepub.epub')
  })
  const values = (name: string) => page.locator(`.settings input[name=${name}]`).evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))
  expect(await values('margin')).toEqual(['0', '200'])
  expect(await values('maxWidth')).toEqual([]) // no choices: not in the menu
  await expect(page.locator('.settings .row', { hasText: '表示幅' })).toHaveCount(0)
  expect(await values('lineHeight')).toHaveLength(5) // not given: those of the reader
  // A label is text, not markup.
  await expect(page.locator('.settings b')).toHaveCount(0)
  await setting(page, 'margin', '200')
  expect(await page.evaluate(() => [(window as any).reader.viewer.options.margin, localStorage.getItem('choices:settings')])).toEqual([200, '{"margin":200}'])
  // A step too small to be seen after rounding still changes the size, up to the largest.
  for (const size of ['23', '24', '24']) {
    await page.locator('.font-up').click()
    await expect(page.locator('.font-size')).toHaveText(size)
  }
  await page.locator('.font-down').click()
  await expect(page.locator('.font-size')).toHaveText('23')
})

test('EpubReader offers only the widths that are narrower than the page', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 700 }) // a phone: every width of the menu is wider
  await page.goto('/app/')
  await page.evaluate(async () => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const root = document.createElement('div')
    root.style.height = '100vh'
    document.body.replaceChildren(root)
    const reader = new EpubReader(root, { storage: null })
    ;(window as any).reader = reader
    await reader.open('/samples/nepub.epub')
  })
  const row = page.locator('.settings .row', { hasText: '表示幅' })
  const offered = () => page.locator('.settings input[name=maxWidth]').evaluateAll((inputs) => inputs.filter((input) => (input as HTMLElement).offsetParent).map((input) => (input as HTMLInputElement).value))
  await page.locator('.settings summary').click()
  await expect(row).toBeHidden()
  await expect(page.locator('.settings .row', { hasText: '余白' })).toBeVisible()
  // The page gets wider (the phone is turned, the window is made larger): the widths that fit come in.
  await page.setViewportSize({ width: 700, height: 400 })
  await expect(row).toBeVisible()
  expect(await offered()).toEqual(['0', '600'])
  await page.setViewportSize({ width: 1250, height: 700 })
  await expect.poll(offered).toEqual(['0', '1200', '1000', '800', '600'])
  // The same for choices of the app, also when they come later.
  await page.evaluate(() => (window as any).reader.setChoices({ maxWidth: [[0, '全幅'], [2000, '広い'], [500, '狭い']] }))
  expect(await offered()).toEqual(['0', '500'])
  // A choice that goes away does not take the focus with it: the menu still closes with Esc.
  await page.locator('.settings input[name=maxWidth][value="500"]').focus()
  await page.setViewportSize({ width: 450, height: 700 })
  await expect(row).toBeHidden()
  expect(await page.evaluate(() => document.activeElement!.localName)).toBe('summary')
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings .panel')).toBeHidden()
})

test('EpubReader.setChoices() replaces rows of the settings menu, and nothing else', async ({ page }) => {
  await page.goto('/app/')
  await page.evaluate(async () => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    // Two readers on the page: the second one is not to be touched.
    document.body.innerHTML = '<div id="a" style="height: 60vh"></div><div id="b" style="height: 40vh"></div>'
    const reader = new EpubReader(document.querySelector('#a')!, { storageKey: 'set-choices', settings: { fontSize: 30 } })
    new EpubReader(document.querySelector('#b')!, { storage: null })
    // What an app adds to the toolbar.
    reader.toolbar.append(Object.assign(document.createElement('button'), { className: 'added', textContent: '次の話' }))
    reader.toolbar.querySelector('.title')!.setAttribute('data-site', 'kept')
    let relocations = 0
    reader.viewer.addEventListener('relocate', () => relocations++)
    Object.assign(window, { reader, relocations: () => relocations })
    await reader.open('/samples/nepub.epub')
    await reader.viewer.next()
  })
  const a = page.locator('#a')
  const values = (name: string, root = a) => root.locator(`.settings input[name=${name}]`).evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))
  const chosen = (name: string) => a.locator(`.settings input[name=${name}]:checked`).evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))
  const rows = () => a.locator('.only-reflowable .row > :first-child').allTextContents()
  /** What must stay as it is: the place in the book, and the parts of the toolbar that are not replaced. */
  const state = () => page.evaluate(() => {
    const { reader, relocations } = window as any
    const kept = [...reader.toolbar.querySelectorAll('.settings .row')].filter((row: Element) => !row.querySelector('[name=margin], [name=lineHeight]'))
    const same = ((window as any).kept ??= kept).every((row: Element, i: number) => row === kept[i])
    return {
      same,
      relocations: relocations(),
      location: reader.viewer.location,
      toolbar: [...reader.toolbar.children].map((child: Element) => child.className),
      site: reader.toolbar.querySelector('.title').dataset.site,
      texts: ['.title', '.pages', '.percent'].map((part) => reader.toolbar.querySelector(part).textContent),
      seek: reader.toolbar.querySelector('.seek').value,
      toc: reader.toolbar.querySelectorAll('.toc-list button').length,
      open: reader.toolbar.querySelector('.settings').open,
      margin: reader.viewer.options.margin,
      saved: localStorage.getItem('set-choices:settings'),
    }
  })
  const setChoices = (choices: object) => page.evaluate((choices) => (window as any).reader.setChoices(choices), choices)
  const setSettings = (settings: object) => page.evaluate((settings) => (window as any).reader.setSettings(settings), settings)

  await a.locator('.settings summary').click()
  await page.waitForTimeout(300) // relocations of the layout that follows the opening are over
  const before = await state()
  expect(before).toMatchObject({ same: true, open: true, margin: 32, saved: null, site: 'kept' })
  expect(before.toolbar).toContain('added')
  expect(await rows()).toEqual(['文字サイズ', 'フォント', '行間', '表示幅', '余白', '表示方向'])

  // The choices given are in the menu, with their labels as text; none has the value of the setting.
  await setChoices({ margin: [[35, '狭い'], [56, '<img src=x onerror="document.title=1">標準'], [112, '"広い"&']] })
  expect(await values('margin')).toEqual(['35', '56', '112'])
  expect(await a.locator('.settings input[name=margin] + span').allTextContents()).toEqual(['狭い', '<img src=x onerror="document.title=1">標準', '"広い"&'])
  await expect(a.locator('.settings img')).toHaveCount(0)
  expect(await chosen('margin')).toEqual([])
  // Only that row has changed: no layout, nothing saved, the menu still open, the rest of the toolbar as it was.
  await page.waitForTimeout(300)
  expect(await state()).toEqual(before)
  expect(await rows()).toEqual(['文字サイズ', 'フォント', '行間', '表示幅', '余白', '表示方向'])
  expect(await values('lineHeight')).toHaveLength(5)
  expect(await values('margin', page.locator('#b'))).toEqual(['16', '32', '64', '96']) // the other reader

  // The choice with the value of the setting is the one chosen, whichever comes first.
  await setSettings({ margin: 56 })
  expect(await chosen('margin')).toEqual(['56'])
  await setSettings({ margin: 70 })
  expect(await chosen('margin')).toEqual([])
  await setChoices({ margin: [[70, 'a'], [90, 'b']] })
  expect(await chosen('margin')).toEqual(['70'])
  // A new choice works as any other: it is applied and saved.
  await a.locator('.settings input[name=margin][value="90"]').check()
  expect(await state()).toMatchObject({ margin: 90, saved: '{"margin":90}', open: true })

  // Rows without choices are gone, and come back to their places.
  await setChoices({ margin: [], lineHeight: [] })
  expect(await rows()).toEqual(['文字サイズ', 'フォント', '表示幅', '表示方向'])
  await setChoices({ margin: [[90, 'b']] })
  expect(await rows()).toEqual(['文字サイズ', 'フォント', '表示幅', '余白', '表示方向'])
  expect(await chosen('margin')).toEqual(['90'])
  await setChoices({ lineHeight: [[0, '本の指定'], [2, '広い']], maxWidth: [], margin: [] })
  await setChoices({ maxWidth: [[0, '全幅']], margin: [[90, 'b'], [100, 'c']] })
  expect(await rows()).toEqual(['文字サイズ', 'フォント', '行間', '表示幅', '余白', '表示方向'])
  expect(await state()).toMatchObject({ same: false, open: true, margin: 90 }) // the row of the width is a new one

  // The focus of someone using the keyboard stays in a row that is replaced: on the choice made, or else the first.
  const focus = () => page.evaluate(() => [document.activeElement!.getAttribute('name') ?? document.activeElement!.localName, (document.activeElement as HTMLInputElement).value ?? ''])
  await a.locator('.settings input[name=margin][value="90"]').focus()
  await setChoices({ margin: [[80, 'a'], [90, 'b'], [100, 'c']] })
  expect(await focus()).toEqual(['margin', '90'])
  await setChoices({ margin: [[10, 'a'], [20, 'b'], [30, 'c']] })
  expect(await focus()).toEqual(['margin', '10'])
  await page.keyboard.press('ArrowRight') // and the keys go on working there
  expect(await chosen('margin')).toEqual(['20'])
  expect((await state()).margin).toBe(20)
  // The focus in another row is left alone.
  await a.locator('.settings input[name=writingMode][value=auto]').focus()
  await setChoices({ margin: [[20, 'b']] })
  expect(await focus()).toEqual(['writingMode', 'auto'])
  // A row that goes away leaves the focus on the button of the menu, from where Esc closes it.
  await a.locator('.settings input[name=margin]').focus()
  await setChoices({ margin: [] })
  expect(await focus()).toEqual(['summary', ''])
  expect((await state()).open).toBe(true)
  await page.keyboard.press('Escape')
  await expect(a.locator('.settings .panel')).toBeHidden()

  // After destroy(), a call does nothing.
  expect(await page.evaluate(() => {
    const { reader } = window as any
    reader.destroy()
    reader.setChoices({ margin: [[1, 'a']], maxWidth: [] })
    return document.querySelector('#a')!.childElementCount
  })).toBe(0)
})
