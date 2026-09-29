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
const DARK = [0, 0, 0]
async function pageBackground(page: Page): Promise<number[]> {
  const box = (await page.locator('iframe').boundingBox())!
  return pixel(page, box.x + 4, box.y + box.height - 4) // inside the page margin
}
const pageCount = async (page: Page) =>
  Number((await page.locator('.progress').textContent())!.match(/\/ (\d+)/)![1])

// User page turns closer together than the viewer's cooldown (100 ms) are dropped as chattering,
// so wait a little after each one.
const AFTER_INPUT = 150
async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key)
  await page.waitForTimeout(AFTER_INPUT)
}
async function click(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y)
  await page.waitForTimeout(AFTER_INPUT)
}

test.describe('nepub-style EPUB (vertical)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/?url=/samples/nepub.epub')
    await expect(page.locator('.progress')).toHaveText(/^1 \/ \d+/)
  })

  test('lays out vertically and turns pages with arrow keys', async ({ page }) => {
    await expect(page.locator('.title')).toHaveText('nepub 形式サンプル')
    expect(await evaluate(page, () => getComputedStyle(document.documentElement).writingMode)).toBe('vertical-rl')
    expect(await pageCount(page)).toBeGreaterThan(1)

    await press(page, 'ArrowLeft') // left = next page for right-to-left books
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    const height = await evaluate(page, () => innerHeight)
    expect(await evaluate(page, () => document.scrollingElement!.scrollTop)).toBe(height)

    await press(page, 'ArrowRight')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
  })

  test('turns pages with the up / down keys too (remote controls)', async ({ page }) => {
    await press(page, 'ArrowDown')
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await press(page, 'ArrowUp')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
  })

  test('keeps a separate reading position for each episode sharing a title', async ({ page }) => {
    await page.goto('/app/?url=/samples/episode-1.epub')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await press(page, 'ArrowLeft')
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await page.goto('/app/?url=/samples/episode-2.epub') // same title and (empty) author as episode 1
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
  })

  test('ignores chattering: presses within the cooldown turn only one page', async ({ page }) => {
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(AFTER_INPUT)
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await press(page, 'ArrowLeft') // after the cooldown, presses work again
    await expect(page.locator('.progress')).toHaveText(/^3 \//)
  })

  test('holding a key turns only one page, even if repeats are not flagged', async ({ page }) => {
    // Some remote controls send key repeats as plain keydown events (repeat: false).
    const send = (type: string) =>
      page.evaluate((type) => window.dispatchEvent(new KeyboardEvent(type, { key: 'ArrowLeft' })), type)
    for (let i = 0; i < 3; i++) {
      await send('keydown')
      await page.waitForTimeout(AFTER_INPUT) // longer than the cooldown
    }
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await send('keyup')
    await send('keydown')
    await expect(page.locator('.progress')).toHaveText(/^3 \//)
  })

  test('keeps working when a key press inside the page moves to the next section', async ({ page }) => {
    const box = (await page.locator('iframe').boundingBox())!
    await click(page, box.x + box.width / 2, box.y + box.height / 2) // focus the page (center: no turn)
    const pages = await pageCount(page)
    for (let i = 1; i < pages; i++) await press(page, 'ArrowLeft')
    // Hold the key while the next section replaces the page document, so the keyup goes elsewhere.
    await page.keyboard.down('ArrowLeft')
    await expect.poll(() => heading(page)).toBe('第2話　サンプル')
    await page.keyboard.up('ArrowLeft')
    await press(page, 'ArrowLeft')
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
  })

  test('moves to the next section after the last page and back', async ({ page }) => {
    const pages = await pageCount(page)
    for (let i = 0; i < pages; i++) await press(page, 'ArrowLeft')
    await expect.poll(() => heading(page)).toBe('第2話　サンプル')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)

    await press(page, 'ArrowRight')
    await expect.poll(() => heading(page)).toBe('第1話　サンプル')
    await expect(page.locator('.progress')).toHaveText(`${pages} / ${pages}（33%）`)
  })

  test('jumps via the table of contents', async ({ page }) => {
    await page.locator('.toc').selectOption({ label: '第3話　サンプル' })
    await expect.poll(() => heading(page)).toBe('第3話　サンプル')
  })

  test('switches to dark mode', async ({ page }) => {
    await page.locator('[data-setting=theme]').selectOption('dark')
    await expect.poll(() => pageBackground(page)).toEqual(DARK)
    expect(await evaluate(page, () => getComputedStyle(document.querySelector('p')!).color)).toBe('rgb(172, 172, 172)')
  })

  test('switches between mincho and gothic fonts', async ({ page }) => {
    const font = () => evaluate(page, () => getComputedStyle(document.querySelector('p')!).fontFamily)
    await expect(page.locator('[data-setting=font]')).toHaveValue('mincho')
    expect(await font()).toContain('Mincho')
    await page.locator('[data-setting=font]').selectOption('gothic')
    await expect.poll(font).toContain('Gothic')
  })

  test('follows the system color scheme by default', async ({ page }) => {
    await expect(page.locator('[data-setting=theme]')).toHaveValue('system')
    await expect.poll(() => pageBackground(page)).toEqual(LIGHT)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => pageBackground(page)).toEqual(DARK)
  })

  test('limits the page width, centered, and turns pages by clicking the sides', async ({ page }) => {
    await page.locator('[data-setting=maxWidth]').selectOption('600')
    const viewer = (await page.locator('.viewer').boundingBox())!
    const frame = page.locator('iframe')
    await expect.poll(async () => (await frame.boundingBox())!.width).toBe(600)
    expect(Math.round((await frame.boundingBox())!.x - viewer.x)).toBe(Math.round((viewer.width - 600) / 2))
    expect(await evaluate(page, () => innerWidth)).toBe(600) // laid out for the narrower page

    await click(page, viewer.x + 10, viewer.y + viewer.height / 2) // left side: next page (vertical)
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await click(page, viewer.x + viewer.width - 10, viewer.y + viewer.height / 2)
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
  })

  test('larger font makes more pages', async ({ page }) => {
    const before = await pageCount(page)
    for (let i = 0; i < 5; i++) await page.locator('.font-up').click()
    await expect.poll(() => pageCount(page)).toBeGreaterThan(before)
  })

  test('resumes from the saved position after reload', async ({ page }) => {
    await press(page, 'ArrowLeft')
    await press(page, 'ArrowLeft')
    await expect(page.locator('.progress')).toHaveText(/^3 \//)
    await page.reload()
    await expect(page.locator('.progress')).toHaveText(/^3 \//)
  })
})

test.describe('general EPUB 2 (horizontal)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/app/?url=/samples/general.epub')
    await expect(page.locator('.progress')).toHaveText(/^1 \/ \d+/)
  })

  test('loads resources, NCX table of contents and turns pages right', async ({ page }) => {
    expect(await evaluate(page, () => getComputedStyle(document.documentElement).writingMode)).toBe('horizontal-tb')
    expect(await evaluate(page, () => (document.getElementById('cover') as HTMLImageElement).naturalWidth)).toBe(200)
    await page.locator('[data-setting=font]').selectOption('book') // keep the book's fonts
    await expect.poll(() => evaluate(page, () => getComputedStyle(document.body).fontFamily)).toBe('serif') // via @import
    await expect(page.locator('.toc option')).toHaveText(['目次', 'Chapter 1', 'Chapter 2', '　Section 2.1'])

    await press(page, 'ArrowRight')
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    const width = await evaluate(page, () => innerWidth)
    expect(await evaluate(page, () => document.scrollingElement!.scrollLeft)).toBe(width)
  })

  test('does not run scripts in the book, even in embedded SVG documents', async ({ page }) => {
    await page.waitForTimeout(1500) // give embedded documents and the meta refresh time to act
    expect(await evaluate(page, () => document.body.dataset.hacked)).toBeUndefined()
    expect(await page.evaluate(() => document.body.dataset.hacked)).toBeUndefined()
    expect(content(page)).toBeTruthy() // not navigated away from the book by <meta http-equiv="refresh">
  })

  test('works on a host page with the Content-Security-Policy given in the README', async ({ page }) => {
    const csp =
      "default-src 'self'; frame-src blob:; img-src blob: data:; style-src 'self' blob: 'unsafe-inline'; font-src blob: data:; media-src blob: data:"
    await page.route('**/app/**', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } })
    })
    await page.goto('/app/?url=/samples/general.epub')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    expect(await evaluate(page, () => (document.getElementById('cover') as HTMLImageElement).naturalWidth)).toBe(200)
    expect(await evaluate(page, () => getComputedStyle(document.querySelector('h1')!).fontSize)).toBe('90px') // styles applied
  })

  test('does not open javascript: links', async ({ page }) => {
    let popups = 0
    page.on('popup', () => popups++)
    await content(page).locator('#js-link').click()
    await page.waitForTimeout(500)
    expect(popups).toBe(0)
    expect(await page.evaluate(() => document.body.dataset.hacked)).toBeUndefined()
  })

  test('turns pages by clicking the left / right side of the page', async ({ page }) => {
    const frame = page.locator('iframe')
    const box = (await frame.boundingBox())!
    await click(page, box.x + box.width * 0.9, box.y + box.height / 2)
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await click(page, box.x + box.width * 0.1, box.y + box.height / 2)
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
  })

  test('follows internal links to a fragment in another section', async ({ page }) => {
    await content(page).locator('#to-2-1').click()
    await expect.poll(() => heading(page)).toBe('Chapter 2')
    await expect(page.locator('.progress')).not.toHaveText(/^1 \//)
    // The target heading is inside the visible page.
    const left = await evaluate(page, () => document.getElementById('section-2-1')!.getBoundingClientRect().left)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(left).toBeLessThan(await evaluate(page, () => innerWidth))
  })

  test('skips non-linear spine items', async ({ page }) => {
    const pages = await pageCount(page)
    for (let i = 0; i < pages; i++) await press(page, 'ArrowRight')
    await expect.poll(() => heading(page)).toBe('Chapter 2')
  })

  test('reports a section that fails to load through the error event', async ({ page }) => {
    let message = ''
    page.on('dialog', (dialog) => {
      message = dialog.message() // the app shows viewer errors with alert()
      void dialog.dismiss()
    })
    await page.locator('.toc').selectOption({ label: '　Section 2.1' }) // the second half of chapter 2
    await expect.poll(() => heading(page)).toBe('Chapter 2')
    // Past the last page of chapter 2 comes a spine item that is missing from the archive.
    for (let i = 0; i < 100 && !message; i++) await press(page, 'ArrowRight')
    expect(message).toContain('missing.xhtml')

    // The viewer stays on the last page and keeps working.
    const last = await page.locator('.progress').textContent()
    await press(page, 'ArrowLeft')
    await expect(page.locator('.progress')).not.toHaveText(last!)
  })

  test('can be forced into vertical writing', async ({ page }) => {
    await page.locator('[data-setting=writingMode]').selectOption('vertical')
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
    await press(page, 'ArrowLeft')
  }
  await expect(status).toHaveText(/2 \/ 3 話/)
  await expect.poll(() => heading(page)).toBe('第2話　サンプル')
  await expect(page.locator('iframe')).toBeVisible() // key presses are ignored while loading

  // Going back opens the previous episode at its last page.
  await press(page, 'ArrowRight')
  await expect(status).toHaveText(/1 \/ 3 話/)
  await expect.poll(() => heading(page)).toBe('第1話　サンプル')
  await expect(page.locator('iframe')).toBeVisible()
})
