// The API as an embedding app uses it: a viewer or a reader made by the test itself.
import { expect, test } from '@playwright/test'
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
