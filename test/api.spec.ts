// The API as an embedding app uses it: a viewer or a reader made by the test itself.
import { expect, test, type Page } from '@playwright/test'
import { content, evaluate, heading, click } from './helpers.ts'

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
