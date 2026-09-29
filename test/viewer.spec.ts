import { expect, test, type Page } from '@playwright/test'
import { inflateSync } from 'node:zlib'

/** The iframe that shows the current section. */
const content = (page: Page) => page.frame({ url: /^blob:/ })!
const evaluate = async <T>(page: Page, fn: () => T) => content(page).evaluate(fn)
// Polled while the iframe may be navigating, so evaluation errors are treated as "not yet".
const heading = (page: Page) =>
  evaluate(page, () => document.querySelector('h1, h2')?.textContent).catch(() => undefined)
/** RGB of the rendered pixel at (x, y), read from a 1×1 PNG screenshot. */
async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, scale: 'css' })
  const idat: Buffer[] = []
  for (let p = 8; p < png.length; p += 12 + png.readUInt32BE(p)) {
    if (png.toString('ascii', p + 4, p + 8) === 'IDAT') idat.push(png.subarray(p + 8, p + 8 + png.readUInt32BE(p)))
  }
  return [...inflateSync(Buffer.concat(idat)).subarray(1, 4)] // [filter, r, g, b, (a)]
}
// Check rendered pixels: computed styles alone missed a white iframe backdrop in dark mode.
const LIGHT = [255, 255, 255]
const DARK = [30, 30, 30]
async function pageBackground(page: Page): Promise<number[]> {
  const box = (await page.locator('#viewer iframe').boundingBox())!
  return pixel(page, box.x + 4, box.y + box.height - 4) // inside the page margin
}
const pageCount = async (page: Page) =>
  Number((await page.locator('#progress').textContent())!.match(/\/ (\d+)/)![1])

test.describe('nepub-style EPUB (vertical)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/?url=/samples/nepub.epub')
    await expect(page.locator('#progress')).toHaveText(/^1 \/ \d+/)
  })

  test('lays out vertically and turns pages with arrow keys', async ({ page }) => {
    await expect(page.locator('#title')).toHaveText('nepub 形式サンプル')
    expect(await evaluate(page, () => getComputedStyle(document.documentElement).writingMode)).toBe('vertical-rl')
    expect(await pageCount(page)).toBeGreaterThan(1)

    await page.keyboard.press('ArrowLeft') // left = next page for right-to-left books
    await expect(page.locator('#progress')).toHaveText(/^2 \//)
    const height = await evaluate(page, () => innerHeight)
    expect(await evaluate(page, () => document.scrollingElement!.scrollTop)).toBe(height)

    await page.keyboard.press('ArrowRight')
    await expect(page.locator('#progress')).toHaveText(/^1 \//)
  })

  test('moves to the next section after the last page and back', async ({ page }) => {
    const pages = await pageCount(page)
    for (let i = 0; i < pages; i++) await page.keyboard.press('ArrowLeft')
    await expect.poll(() => heading(page)).toBe('第2話　サンプル')
    await expect(page.locator('#progress')).toHaveText(/^1 \//)

    await page.keyboard.press('ArrowRight')
    await expect.poll(() => heading(page)).toBe('第1話　サンプル')
    await expect(page.locator('#progress')).toHaveText(`${pages} / ${pages}（33%）`)
  })

  test('jumps via the table of contents', async ({ page }) => {
    await page.locator('#toc').selectOption({ label: '第3話　サンプル' })
    await expect.poll(() => heading(page)).toBe('第3話　サンプル')
  })

  test('switches to dark mode', async ({ page }) => {
    await page.locator('#theme').selectOption('dark')
    await expect.poll(() => pageBackground(page)).toEqual(DARK)
    expect(await evaluate(page, () => getComputedStyle(document.querySelector('p')!).color)).toBe('rgb(212, 212, 212)')
  })

  test('follows the system color scheme by default', async ({ page }) => {
    await expect(page.locator('#theme')).toHaveValue('system')
    await expect.poll(() => pageBackground(page)).toEqual(LIGHT)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => pageBackground(page)).toEqual(DARK)
  })

  test('larger font makes more pages', async ({ page }) => {
    const before = await pageCount(page)
    for (let i = 0; i < 5; i++) await page.locator('#font-up').click()
    await expect.poll(() => pageCount(page)).toBeGreaterThan(before)
  })

  test('resumes from the saved position after reload', async ({ page }) => {
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('#progress')).toHaveText(/^3 \//)
    await page.reload()
    await expect(page.locator('#progress')).toHaveText(/^3 \//)
  })
})

test.describe('general EPUB 2 (horizontal)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/?url=/samples/general.epub')
    await expect(page.locator('#progress')).toHaveText(/^1 \/ \d+/)
  })

  test('loads resources, NCX table of contents and turns pages right', async ({ page }) => {
    expect(await evaluate(page, () => getComputedStyle(document.documentElement).writingMode)).toBe('horizontal-tb')
    expect(await evaluate(page, () => (document.getElementById('cover') as HTMLImageElement).naturalWidth)).toBe(200)
    expect(await evaluate(page, () => getComputedStyle(document.body).fontFamily)).toBe('serif') // via @import
    await expect(page.locator('#toc option')).toHaveText(['目次', 'Chapter 1', 'Chapter 2', '　Section 2.1'])

    await page.keyboard.press('ArrowRight')
    await expect(page.locator('#progress')).toHaveText(/^2 \//)
    const width = await evaluate(page, () => innerWidth)
    expect(await evaluate(page, () => document.scrollingElement!.scrollLeft)).toBe(width)
  })

  test('does not run scripts in the book', async ({ page }) => {
    expect(await evaluate(page, () => document.body.dataset.hacked)).toBeUndefined()
  })

  test('turns pages by clicking the left / right side of the page', async ({ page }) => {
    const frame = page.locator('#viewer iframe')
    const box = (await frame.boundingBox())!
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2)
    await expect(page.locator('#progress')).toHaveText(/^2 \//)
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height / 2)
    await expect(page.locator('#progress')).toHaveText(/^1 \//)
  })

  test('follows internal links to a fragment in another section', async ({ page }) => {
    await content(page).locator('#to-2-1').click()
    await expect.poll(() => heading(page)).toBe('Chapter 2')
    await expect(page.locator('#progress')).not.toHaveText(/^1 \//)
    // The target heading is inside the visible page.
    const left = await evaluate(page, () => document.getElementById('section-2-1')!.getBoundingClientRect().left)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(left).toBeLessThan(await evaluate(page, () => innerWidth))
  })

  test('skips non-linear spine items', async ({ page }) => {
    const pages = await pageCount(page)
    for (let i = 0; i < pages; i++) await page.keyboard.press('ArrowRight')
    await expect.poll(() => heading(page)).toBe('Chapter 2')
  })

  test('can be forced into vertical writing', async ({ page }) => {
    await page.locator('#writing-mode').selectOption('vertical')
    await expect.poll(() => evaluate(page, () => getComputedStyle(document.body).writingMode)).toBe('vertical-rl')
  })
})

test('series example opens the next / previous episode at the book boundaries', async ({ page }) => {
  await page.goto('/examples/series.html')
  const status = page.locator('#status')
  await expect(status).toHaveText(/1 \/ 3 話/)
  await expect.poll(() => heading(page)).toBe('第1話　サンプル')

  // Turn pages until the next episode opens.
  for (let i = 0; i < 20 && !(await status.textContent())?.includes('2 / 3'); i++) {
    await page.keyboard.press('ArrowLeft')
  }
  await expect(status).toHaveText(/2 \/ 3 話/)
  await expect.poll(() => heading(page)).toBe('第2話　サンプル')
  await expect(page.locator('#viewer iframe')).toBeVisible() // key presses are ignored while loading

  // Going back opens the previous episode at its last page.
  await page.keyboard.press('ArrowRight')
  await expect(status).toHaveText(/1 \/ 3 話/)
  await expect.poll(() => heading(page)).toBe('第1話　サンプル')
  await expect(page.locator('#viewer iframe')).toBeVisible()
})
