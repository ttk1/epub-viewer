import { expect, test, type Frame, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

/** The messages of the alert() dialogs from now on: the app shows the errors of the viewer with them. */
function collectAlerts(page: Page): string[] {
  const messages: string[] = []
  page.on('dialog', (dialog) => {
    messages.push(dialog.message())
    void dialog.dismiss()
  })
  return messages
}
async function openSettings(page: Page): Promise<void> {
  if ((await page.locator('.settings[open]').count()) === 0) await page.locator('.settings summary').click()
}
/** Picks a value in the settings menu. */
async function setting(page: Page, name: string, value: string): Promise<void> {
  await openSettings(page)
  await page.locator(`.settings input[name=${name}][value="${value}"]`).check()
}
async function chooseChapter(page: Page, label: string): Promise<void> {
  await page.locator('.toc summary').click()
  await page.locator('.toc-list').getByRole('button', { name: label, exact: true }).click()
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
    const height = await evaluate(page, () => document.documentElement.offsetHeight) // the page; the frame may be a fraction of a pixel taller
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

  test('turns one page per mouse wheel / trackpad gesture', async ({ page }) => {
    const box = (await page.locator('iframe').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    // Longer than the gap that ends a wheel gesture (150 ms).
    const wheel = async (dx: number, dy: number) => {
      await page.mouse.wheel(dx, dy)
      await page.waitForTimeout(250)
    }
    await wheel(0, 100) // down: next page
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await wheel(0, -100)
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await wheel(-100, 0) // sideways to the left: next page for vertical books
    await expect(page.locator('.progress')).toHaveText(/^2 \//)

    // A trackpad swipe: many small events in a row turn only one page.
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 8)
    await page.waitForTimeout(250)
    await expect(page.locator('.progress')).toHaveText(/^3 \//)
  })

  test('keeps a separate reading position for each episode sharing a title', async ({ page }) => {
    await page.goto('/app/?url=/samples/episode-1.epub')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await expect(page.locator('.toc')).toBeHidden() // no table of contents button for a single episode
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
    // nepub lists chapters, each linking to its first episode, with their episodes below.
    await expect(page.locator('.toc-list button')).toHaveText(['第一章', '第1話　サンプル', '第2話　サンプル', '第二章', '第3話　サンプル'])
    await expect(page.locator('.toc-list [aria-current]')).toHaveText('第1話　サンプル') // the episode, not its chapter
    await chooseChapter(page, '第3話　サンプル')
    await expect.poll(() => heading(page)).toBe('第3話　サンプル')
    await expect(page.locator('.toc-list')).toBeHidden() // the menu closes
    await expect(page.locator('.toc-list [aria-current]')).toHaveText('第3話　サンプル')
  })

  test('operates the table of contents from the keyboard, without turning pages', async ({ page }) => {
    await page.locator('.toc summary').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: '第1話　サンプル' })).toBeFocused() // the current chapter
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('button', { name: '第2話　サンプル' })).toBeFocused()
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await page.keyboard.press('Escape')
    await expect(page.locator('.toc-list')).toBeHidden()
    await expect(page.locator('.toc summary')).toBeFocused()
  })

  test('a click on the page closes an open menu, without turning the page', async ({ page }) => {
    await openSettings(page)
    const box = (await page.locator('iframe').boundingBox())!
    await click(page, box.x + 50, box.y + box.height - 50) // the left side, which turns the page otherwise
    await expect(page.locator('.settings .panel')).toBeHidden()
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await click(page, box.x + 50, box.y + box.height - 50)
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
  })

  test('switches to dark mode', async ({ page }) => {
    await setting(page, 'theme', 'dark')
    await expect.poll(() => pageBackground(page)).toEqual(DARK)
    expect(await evaluate(page, () => getComputedStyle(document.querySelector('p')!).color)).toBe('rgb(172, 172, 172)')
  })

  test('switches between mincho and gothic fonts', async ({ page }) => {
    const font = () => evaluate(page, () => getComputedStyle(document.querySelector('p')!).fontFamily)
    await expect(page.locator('input[name=font]:checked')).toHaveValue('mincho')
    expect(await font()).toContain('Mincho')
    await setting(page, 'font', 'gothic')
    await expect.poll(font).toContain('Gothic')
  })

  test('follows the system color scheme by default', async ({ page }) => {
    await expect(page.locator('input[name=theme]:checked')).toHaveValue('system')
    await expect.poll(() => pageBackground(page)).toEqual(LIGHT)
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => pageBackground(page)).toEqual(DARK)
  })

  test('limits the page width, centered, and turns pages by clicking the sides', async ({ page }) => {
    await setting(page, 'maxWidth', '600')
    const viewer = (await page.locator('.viewer').boundingBox())!
    const frame = page.locator('iframe')
    await expect.poll(async () => (await frame.boundingBox())!.width).toBe(600)
    expect(Math.round((await frame.boundingBox())!.x - viewer.x)).toBe(Math.round((viewer.width - 600) / 2))
    expect(await evaluate(page, () => innerWidth)).toBe(600) // laid out for the narrower page
    await page.locator('.title').click() // closes the menu

    await click(page, viewer.x + 10, viewer.y + viewer.height / 2) // left side: next page (vertical)
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await click(page, viewer.x + viewer.width - 10, viewer.y + viewer.height / 2)
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
  })

  test('breaks a run of "…" longer than a page instead of letting it run into the next page', async ({ page }) => {
    const [lineLengths, pageHeight] = await evaluate(page, () => {
      const p = [...document.querySelectorAll('p')].find((p) => p.textContent!.includes('…'.repeat(20)))!
      const range = document.createRange()
      range.selectNodeContents(p)
      const { paddingTop, paddingBottom } = getComputedStyle(document.documentElement)
      const pageHeight = innerHeight - parseFloat(paddingTop) - parseFloat(paddingBottom)
      return [[...range.getClientRects()].map((r) => r.height), pageHeight] as const
    })
    expect(lineLengths.length).toBeGreaterThan(1)
    for (const length of lineLengths) expect(length).toBeLessThanOrEqual(pageHeight + 1)
  })

  test('fits an illustration larger than a page into one page', async ({ page }) => {
    const image = () =>
      evaluate(page, () => {
        const img = document.querySelector('img')!
        const { top, bottom, left, right } = img.getBoundingClientRect()
        return { top, bottom, left, right, pageWidth: innerWidth, pageHeight: innerHeight, naturalWidth: img.naturalWidth }
      })
    // Pages follow each other downwards in vertical writing: turn pages until the image is on the current one.
    for (let i = 0; i < 40 && !(await image().then((box) => box.top >= 0 && box.top < box.pageHeight)); i++) {
      await press(page, 'ArrowLeft')
    }
    const box = await image()
    expect(box.naturalWidth).toBe(800) // 800 × 1200
    expect(box.top).toBeGreaterThanOrEqual(0)
    expect(box.bottom).toBeLessThanOrEqual(box.pageHeight)
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(box.pageWidth)
    expect((box.right - box.left) / (box.bottom - box.top)).toBeCloseTo(800 / 1200, 1) // not distorted
    expect(box.bottom - box.top).toBeGreaterThan(box.pageHeight / 2) // and as large as the page allows
  })

  test('changes the line height', async ({ page }) => {
    const lineHeight = () => evaluate(page, () => getComputedStyle(document.querySelector('p')!).lineHeight)
    await expect(page.locator('input[name=lineHeight]:checked')).toHaveValue('0') // the book's own: nepub sets none
    expect(await lineHeight()).toBe('72px') // 45px × 1.6
    const before = await pageCount(page)
    await setting(page, 'lineHeight', '2.2')
    expect(await lineHeight()).toBe('99px')
    expect(await pageCount(page)).toBeGreaterThan(before)
    // nepub sets the line height of text set upright in a vertical line itself; that is kept.
    expect(await evaluate(page, () => getComputedStyle(document.querySelector('.tcy')!).lineHeight)).toBe('45px')
  })

  test('larger font makes more pages', async ({ page }) => {
    const before = await pageCount(page)
    await openSettings(page)
    for (let i = 0; i < 5; i++) await page.locator('.font-up').click()
    await expect.poll(() => pageCount(page)).toBeGreaterThan(before)
  })

  test('keeps the text being read on the page when the layout changes', async ({ page }) => {
    for (let i = 0; i < 12; i++) await press(page, 'ArrowLeft')
    // The paragraph of the first line of the page (top right, in vertical writing).
    await evaluate(page, () => {
      document.elementFromPoint(innerWidth - 40, 40)!.closest('p')!.id = 'reading'
    })
    const visible = () =>
      evaluate(page, () =>
        [...document.getElementById('reading')!.getClientRects()].some((r) => r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth),
      )
    await openSettings(page)
    for (const change of ['.font-up', '.font-up', '.font-up', '.font-down', '.font-down', '.font-down', '.font-down', '.font-down']) {
      await page.locator(change).click()
      expect(await visible()).toBe(true)
    }
    await setting(page, 'writingMode', 'horizontal')
    expect(await visible()).toBe(true)
    await page.setViewportSize({ width: 500, height: 800 })
    await expect.poll(visible).toBe(true)
  })

  test('resumes from the saved position after reload', async ({ page }) => {
    await press(page, 'ArrowLeft')
    await press(page, 'ArrowLeft')
    await expect(page.locator('.progress')).toHaveText(/^3 \//)
    await page.reload()
    await expect(page.locator('.progress')).toHaveText(/^3 \//)
  })

  test('starts from the beginning when the saved position is not in the book', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('epub-viewer:position:/samples/nepub.epub', JSON.stringify({ index: 99, progress: 0 }))
    })
    await page.reload()
    await expect.poll(() => heading(page)).toBe('第1話　サンプル')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
  })

  test('saves only the settings that the user changed', async ({ page }) => {
    const saved = () => page.evaluate(() => localStorage.getItem('epub-viewer:settings'))
    expect(await saved()).toBeNull()
    await setting(page, 'theme', 'dark')
    await page.locator('.font-up').click()
    expect(JSON.parse((await saved())!)).toEqual({ theme: 'dark', fontSize: 54 })
    await page.reload()
    await expect(page.locator('input[name=theme]:checked')).toHaveValue('dark')
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
    await setting(page, 'font', 'book') // keep the book's fonts
    await expect.poll(() => evaluate(page, () => getComputedStyle(document.body).fontFamily)).toBe('serif') // via @import
    await expect(page.locator('.toc-list button')).toHaveText(['Chapter 1', 'Chapter 2', 'Section 2.1'])

    await press(page, 'ArrowRight')
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    const width = await evaluate(page, () => document.documentElement.offsetWidth)
    expect(await evaluate(page, () => document.scrollingElement!.scrollLeft)).toBe(width)
  })

  test('loads images given by srcset, a style attribute and an SVG <image>', async ({ page }) => {
    const urls = await evaluate(page, () => [
      (document.getElementById('srcset') as HTMLImageElement).currentSrc,
      getComputedStyle(document.getElementById('inline-style')!).backgroundImage,
      document.getElementById('svg-image')!.getAttribute('xlink:href'),
    ])
    for (const url of urls) expect(url).toContain('blob:')
    expect(await evaluate(page, () => (document.getElementById('srcset') as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  })

  test('wraps a long line in <pre> instead of letting it run into the next page', async ({ page }) => {
    const [preWidth, pageWidth] = await evaluate(page, () => {
      const { paddingLeft, paddingRight } = getComputedStyle(document.documentElement)
      const pageWidth = innerWidth - parseFloat(paddingLeft) - parseFloat(paddingRight)
      return [document.getElementById('long-pre')!.scrollWidth, pageWidth]
    })
    expect(preWidth).toBeLessThanOrEqual(pageWidth + 1)
  })

  test('does not run scripts in the book, even in embedded SVG documents', async ({ page }) => {
    await page.waitForTimeout(1500) // give embedded documents and the meta refresh time to act
    expect(await evaluate(page, () => document.body.dataset.hacked)).toBeUndefined()
    expect(await page.evaluate(() => document.body.dataset.hacked)).toBeUndefined()
    expect(content(page)).toBeTruthy() // not navigated away from the book by <meta http-equiv="refresh">
  })

  // Spine items that a CSP <meta> does not protect: see make-samples.js.
  for (const target of ['probe', 'nohead', 'svgroot', 'xslt']) {
    test(`does not run scripts in a hostile spine item (${target})`, async ({ page }) => {
      await content(page).locator(`#to-${target}`).click()
      await page.waitForTimeout(1000)
      expect(await page.evaluate(() => document.body.dataset.hacked)).toBeUndefined()
    })
  }

  test('reads XHTML that is not well-formed', async ({ page }) => {
    await content(page).locator('#to-notes').click()
    await expect.poll(() => heading(page)).toBe('注記')
  })

  test('follows links inside SVG', async ({ page }) => {
    await content(page).locator('#svg-link').click()
    await expect.poll(() => heading(page)).toBe('Chapter 2')
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
    await click(page, box.x + box.width / 2, box.y + box.height - 40) // the middle: nothing
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await click(page, box.x + box.width * 0.9, box.y + box.height / 2)
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await click(page, box.x + box.width * 0.1, box.y + box.height / 2)
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
  })

  test('a click that only clears a text selection does not turn the page', async ({ page }) => {
    const box = (await page.locator('iframe').boundingBox())!
    await evaluate(page, () => getSelection()!.selectAllChildren(document.querySelector('h1')!))
    await click(page, box.x + box.width * 0.9, box.y + box.height - 40)
    expect(await evaluate(page, () => getSelection()!.isCollapsed)).toBe(true)
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await click(page, box.x + box.width * 0.9, box.y + box.height - 40) // the next click turns the page
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
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

  test('follows links to a fragment in the same section', async ({ page }) => {
    await chooseChapter(page, 'Chapter 2')
    await expect.poll(() => heading(page)).toBe('Chapter 2')
    await content(page).locator('#to-local').click()
    await expect(page.locator('.progress')).not.toHaveText(/^1 \//)
    const left = await evaluate(page, () => document.getElementById('section-2-1')!.getBoundingClientRect().left)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(left).toBeLessThan(await evaluate(page, () => innerWidth))
  })

  test('continues from where the browser scrolled the page by itself (find in page, focus)', async ({ page }) => {
    await chooseChapter(page, 'Chapter 2')
    await expect.poll(() => heading(page)).toBe('Chapter 2')
    // As find in page does for a match on a later page.
    const found = await evaluate(page, () => {
      document.getElementById('section-2-1')!.scrollIntoView()
      return Math.round(document.scrollingElement!.scrollLeft / innerWidth)
    })
    expect(found).toBeGreaterThan(1)
    await expect(page.locator('.progress')).toHaveText(new RegExp(`^${found + 1} /`))
    await press(page, 'ArrowRight') // the next page from there, not from the page shown before
    await expect(page.locator('.progress')).toHaveText(new RegExp(`^${found + 2} /`))
    expect(await evaluate(page, () => document.scrollingElement!.scrollLeft / innerWidth)).toBe(found + 1)
  })

  test('skips non-linear spine items', async ({ page }) => {
    const pages = await pageCount(page)
    for (let i = 0; i < pages; i++) await press(page, 'ArrowRight')
    await expect.poll(() => heading(page)).toBe('Chapter 2')
  })

  test('reports a section that fails to load through the error event', async ({ page }) => {
    const alerts = collectAlerts(page)
    await chooseChapter(page, 'Section 2.1') // the second half of chapter 2
    await expect.poll(() => heading(page)).toBe('Chapter 2')
    // Past the last page of chapter 2 comes a spine item that is missing from the archive.
    for (let i = 0; i < 100 && !alerts.length; i++) await press(page, 'ArrowRight')
    expect(alerts[0]).toContain('missing.xhtml')

    // The viewer stays on the last page and keeps working.
    const last = await page.locator('.progress').textContent()
    await press(page, 'ArrowLeft')
    await expect(page.locator('.progress')).not.toHaveText(last!)
  })

  test('a navigation that fails does not cancel the one before it', async ({ page }) => {
    const alerts = collectAlerts(page)
    await chooseChapter(page, 'Chapter 2')
    await expect.poll(() => heading(page)).toBe('Chapter 2')
    // Chapter 1 from the table of contents, and before it is shown, a link to a missing file.
    await page.evaluate(() => {
      document.querySelector<HTMLElement>('.toc-list button')!.click()
      document.querySelector('iframe')!.contentDocument!.getElementById('to-missing')!.click()
    })
    await expect.poll(() => heading(page)).toBe('Chapter 1')
    expect(alerts[0]).toContain('missing.xhtml')
    await press(page, 'ArrowRight') // and the viewer keeps working
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
  })

  test('shows a section whose stylesheets import each other, and keeps working', async ({ page }) => {
    await content(page).locator('#to-cyclic').click()
    await expect.poll(() => heading(page)).toBe('Cyclic')
    expect(await evaluate(page, () => getComputedStyle(document.querySelector('h1')!).letterSpacing)).toBe('1px') // cycle-a.css
    await chooseChapter(page, 'Chapter 2')
    await expect.poll(() => heading(page)).toBe('Chapter 2')
    await press(page, 'ArrowRight')
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
  })

  test('a navigation that never finishes does not block page turns after a later one', async ({ page }) => {
    // The book stops answering for one file, as a broken or huge archive might.
    await page.evaluate(() => {
      const read = Blob.prototype.slice
      Blob.prototype.slice = function (...args) {
        const blob = read.apply(this, args)
        if ((window as any).hang) blob.arrayBuffer = () => new Promise(() => {})
        return blob
      }
      ;(window as any).hang = true
    })
    await content(page).locator('#to-notes').click() // never arrives
    await page.waitForTimeout(300)
    await page.evaluate(() => ((window as any).hang = false))
    await chooseChapter(page, 'Chapter 2')
    await expect.poll(() => heading(page)).toBe('Chapter 2')
    await press(page, 'ArrowRight')
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
  })

  test('a chosen line height overrides the one that the book sets', async ({ page }) => {
    const lineHeight = () => evaluate(page, () => getComputedStyle(document.querySelector('p')!).lineHeight)
    await evaluate(page, () => document.head.append(Object.assign(document.createElement('style'), { textContent: 'p { line-height: 3; }' })))
    expect(await lineHeight()).toBe('135px') // the book's: 45px × 3
    await setting(page, 'lineHeight', '2.2')
    expect(await lineHeight()).toBe('99px')
    await setting(page, 'lineHeight', '0')
    expect(await lineHeight()).toBe('135px')
  })

  test('shows the settings for text only', async ({ page }) => {
    await openSettings(page)
    await expect(page.locator('.settings .row:visible > :first-child')).toHaveText(['文字サイズ', 'フォント', '行間', '表示幅', '表示方向', '見開き', 'テーマ'])
  })

  test('lays out horizontal text in two columns for a spread', async ({ page }) => {
    const pages = await pageCount(page)
    const layout = () =>
      evaluate(page, () => {
        const { columnWidth, columnGap, paddingLeft } = getComputedStyle(document.documentElement)
        return [parseFloat(columnWidth), parseFloat(columnGap), parseFloat(paddingLeft), document.documentElement.offsetWidth]
      })
    const [single, , , width] = await layout()
    expect(single).toBe(width - 64) // one column per page, with the margin (32) on both sides
    await setting(page, 'spread', 'always')
    const [column, gap, padding] = await layout()
    expect(2 * column + gap + 2 * padding).toBe(width) // two columns to a page
    expect(await pageCount(page)).toBeLessThan(pages)
    expect(await evaluate(page, () => (document.getElementById('cover') as HTMLImageElement).width)).toBeLessThanOrEqual(column)
    await page.locator('.title').click() // closes the menu
    await press(page, 'ArrowRight')
    expect(await evaluate(page, () => document.scrollingElement!.scrollLeft)).toBe(width) // a page is still the whole width
  })

  test('can be forced into vertical writing', async ({ page }) => {
    await setting(page, 'writingMode', 'vertical')
    await expect.poll(() => evaluate(page, () => getComputedStyle(document.body).writingMode)).toBe('vertical-rl')
  })
})

test.describe('fixed-layout EPUB (manga, right to left)', () => {
  /** The pages on the screen, from left to right: the title of each, and where its frame is. */
  const shown = (page: Page) =>
    page.locator('iframe').evaluateAll((frames) =>
      (frames as HTMLIFrameElement[])
        .filter((frame) => getComputedStyle(frame).visibility === 'visible') // not those in which the next pages are loading
        .map((frame) => ({ title: frame.contentDocument!.title, box: frame.getBoundingClientRect().toJSON() as DOMRect }))
        .sort((a, b) => a.box.left - b.box.left),
    )
  const titles = async (page: Page) => (await shown(page)).map((frame) => frame.title)
  const open = async (page: Page, name = 'fixed') => {
    await page.goto(`/app/?url=/samples/${name}.epub`)
    await expect(page.locator('.progress')).toHaveText(/^1 \/ \d+/)
  }

  test('shows the cover alone, then two pages side by side, scaled to fit', async ({ page }) => {
    await open(page)
    const viewer = (await page.locator('.viewer').boundingBox())!
    const [cover] = await shown(page)
    expect(cover.title).toBe('Page 1')
    expect(cover.box.height).toBeCloseTo(viewer.height, 0) // as large as the viewer allows
    expect(cover.box.width / cover.box.height).toBeCloseTo(600 / 900, 2) // in the proportions of the page
    expect(cover.box.left + cover.box.width / 2).toBeCloseTo(viewer.x + viewer.width / 2, 0) // centered
    // The page itself is laid out at its own size, whatever the scale.
    expect(await evaluate(page, () => [innerWidth, innerHeight, document.querySelector('img')!.width])).toEqual([600, 900, 600])

    await press(page, 'ArrowLeft') // left = next, for a book read from right to left
    await expect(page.locator('.progress')).toHaveText('2 / 6（50%）')
    const [left, right] = await shown(page)
    expect([left.title, right.title]).toEqual(['Page 3', 'Page 2']) // the first page of the pair on the right
    expect(left.box.right).toBeCloseTo(right.box.left, 0) // no gap between them
    expect(left.box.left).toBeGreaterThanOrEqual(viewer.x)
    expect(right.box.right).toBeLessThanOrEqual(viewer.x + viewer.width)
    expect(left.box.height).toBeCloseTo(viewer.height, 0)

    await press(page, 'ArrowLeft')
    expect(await titles(page)).toEqual(['Page 5', 'Page 4'])
    await press(page, 'ArrowLeft')
    expect(await titles(page)).toEqual(['Page 6']) // the last page has no partner
    await expect(page.locator('.progress')).toHaveText('6 / 6（100%）')
    await press(page, 'ArrowLeft') // the end of the book
    expect(await titles(page)).toEqual(['Page 6'])
    await press(page, 'ArrowRight')
    expect(await titles(page)).toEqual(['Page 5', 'Page 4'])
  })

  test('keeps a page on the screen while the next one loads', async ({ page }) => {
    await open(page)
    // The fewest pages visible in any frame of the animation, while pages are turned.
    await page.evaluate(() => {
      const state = ((window as any).state = { fewest: Infinity, stop: false })
      const sample = () => {
        const visible = [...document.querySelectorAll('iframe')].filter(
          (frame) => getComputedStyle(frame).visibility === 'visible' && frame.contentDocument?.URL.startsWith('blob:'),
        )
        state.fewest = Math.min(state.fewest, visible.length)
        if (!state.stop) requestAnimationFrame(sample)
      }
      sample()
    })
    for (let i = 0; i < 3; i++) await press(page, 'ArrowLeft')
    expect(await titles(page)).toEqual(['Page 6'])
    expect(await page.evaluate(() => ((window as any).state.stop = true) && (window as any).state.fewest)).toBeGreaterThanOrEqual(1)
  })

  test('turns pages by clicks and the wheel on either page', async ({ page }) => {
    await open(page)
    const viewer = (await page.locator('.viewer').boundingBox())!
    const middle = viewer.y + viewer.height / 2
    await click(page, viewer.x + viewer.width / 2 - 100, middle) // the left side of the cover
    expect(await titles(page)).toEqual(['Page 3', 'Page 2'])
    await click(page, viewer.x + viewer.width / 2 - 300, middle) // the left page
    expect(await titles(page)).toEqual(['Page 5', 'Page 4'])
    await click(page, viewer.x + viewer.width / 2 + 300, middle) // the right page
    expect(await titles(page)).toEqual(['Page 3', 'Page 2'])
    await click(page, viewer.x + viewer.width / 2, middle) // the middle of the spread: nothing
    expect(await titles(page)).toEqual(['Page 3', 'Page 2'])

    await page.mouse.move(viewer.x + viewer.width / 2 + 200, middle)
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(250)
    expect(await titles(page)).toEqual(['Page 5', 'Page 4'])
  })

  test('shows single pages when there is no room for two, or when told so', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 1000 })
    await open(page)
    await press(page, 'ArrowLeft')
    expect(await titles(page)).toEqual(['Page 2'])
    await expect(page.locator('.progress')).toHaveText('2 / 6（33%）')
    const viewer = (await page.locator('.viewer').boundingBox())!
    expect((await shown(page))[0].box.height).toBeCloseTo(viewer.height, 0)

    // Turned to landscape, the same page is shown with its partner; and without, when spreads are turned off.
    await page.setViewportSize({ width: 1280, height: 720 })
    await expect.poll(() => titles(page)).toEqual(['Page 3', 'Page 2'])
    await setting(page, 'spread', 'never')
    await expect.poll(() => titles(page)).toEqual(['Page 2'])
    await page.locator('.title').click() // closes the menu
    await press(page, 'ArrowLeft')
    expect(await titles(page)).toEqual(['Page 3'])
  })

  test('pairs pages after the cover when the book does not say which side they are on', async ({ page }) => {
    await open(page, 'fixed-plain')
    expect(await titles(page)).toEqual(['Page 1'])
    await press(page, 'ArrowLeft')
    expect(await titles(page)).toEqual(['Page 3', 'Page 2'])
    await press(page, 'ArrowLeft')
    expect(await titles(page)).toEqual(['Page 5', 'Page 4'])
  })

  test('follows the direction chosen for a book that does not say, and shows the settings for pages only', async ({ page }) => {
    await open(page, 'fixed-plain')
    await openSettings(page)
    await expect(page.locator('.settings .row:visible > :first-child')).toHaveText(['見開き', '開き方向', 'テーマ'])
    await setting(page, 'direction', 'ltr')
    await page.locator('.title').click() // closes the menu
    await press(page, 'ArrowRight') // right = next, for a book read from left to right
    expect(await titles(page)).toEqual(['Page 2', 'Page 3']) // the first page of the pair on the left
    await press(page, 'ArrowLeft')
    expect(await titles(page)).toEqual(['Page 1'])
  })

  test('jumps via the table of contents and resumes after reload', async ({ page }) => {
    await open(page)
    await chooseChapter(page, '第2話') // page 4
    await expect.poll(() => titles(page)).toEqual(['Page 5', 'Page 4'])
    await expect(page.locator('.progress')).toHaveText(/^4 \/ 6/)
    await page.reload()
    await expect.poll(() => titles(page)).toEqual(['Page 5', 'Page 4'])
  })
})

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
      return { index: detail.index, page: detail.page, pages: detail.pages, fraction: detail.fraction }
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
  expect(results.pages.middle).toMatchObject({ index: 1, fraction: 0.5 }) // the spread of pages 2 and 3, of 6
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

test('EpubReader shows the book opened last, even when an earlier one takes longer to load', async ({ page }) => {
  await page.goto('/app/')
  const titles = await page.evaluate(async () => {
    const { EpubReader } = await import('/dist/src/index.js' as string)
    const root = document.createElement('div')
    root.style.height = '100vh'
    document.body.replaceChildren(root)
    const reader = new EpubReader(root, { storageKey: '' })
    const episode = await (await fetch('/samples/episode-1.epub')).blob()
    // The first one has to be fetched; the second is at hand and is ready sooner.
    const books = await Promise.all([reader.open('/samples/nepub.epub'), reader.open(episode)])
    return [...books.map((book) => book.metadata.title), reader.book!.metadata.title]
  })
  expect(titles).toEqual(['連載サンプル', '連載サンプル', '連載サンプル']) // both calls give the book that is shown
  await expect(page.locator('.title')).toHaveText('連載サンプル')
  await expect.poll(() => heading(page)).toBe('第1話　サンプル')
})

test('the app opens a file dropped on the page, before and after a book is open', async ({ page }) => {
  // The page is a document inside an iframe, so the drop happens there, with a File made there.
  const drop = async (frame: Frame, name: string) => {
    const base64 = readFileSync(`samples/${name}`).toString('base64')
    const dataTransfer = await frame.evaluateHandle(
      ([base64, name]) => {
        const data = new DataTransfer()
        data.items.add(new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], name))
        return data
      },
      [base64, name],
    )
    await frame.locator('html').dispatchEvent('drop', { dataTransfer })
  }
  await page.goto('/app/')
  await drop(page.frames().find((frame) => frame !== page.mainFrame())!, 'episode-1.epub')
  await expect(page.locator('.progress')).toHaveText(/^1 \//)
  await press(page, 'ArrowLeft')
  await expect(page.locator('.progress')).toHaveText(/^2 \//)

  // Positions are kept by file name: episode 2 has the same title, and no identifier.
  await drop(content(page), 'episode-2.epub')
  await expect.poll(() => heading(page)).toBe('第2話　サンプル')
  await expect(page.locator('.progress')).toHaveText(/^1 \//)
})

test('the app opens a file dragged in from outside the browser', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'a drag with a file can only be injected through the Chrome DevTools Protocol')
  await page.goto('/app/?url=/samples/general.epub')
  await expect(page.locator('.progress')).toHaveText(/^1 \//)
  // A real drag, which goes through the browser's own handling: without a drop handler in the
  // document under the pointer (the page, inside the iframe), the browser would open the file itself.
  const client = await page.context().newCDPSession(page)
  const data = { items: [], files: [resolve('samples/episode-1.epub')], dragOperationsMask: 1 }
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
    await client.send('Input.dispatchDragEvent', { type, x: 640, y: 400, data })
  }
  await expect(page.locator('.title')).toHaveText('連載サンプル')
  await expect.poll(() => heading(page)).toBe('第1話　サンプル')
  expect(page.url()).toContain('/app/') // the browser did not navigate to the file
})

test('Space and Enter on a focused toolbar control operate it instead of turning the page', async ({ page }) => {
  await page.goto('/app/?url=/samples/nepub.epub')
  await expect(page.locator('.progress')).toHaveText(/^1 \//)
  await page.locator('.settings summary').focus()
  await press(page, 'Space')
  await expect(page.locator('.settings .panel')).toBeVisible()
  await page.locator('.font-up').focus()
  await press(page, 'Space')
  await expect(page.locator('.font-size')).toHaveText('54')
  await press(page, 'Enter')
  await expect(page.locator('.font-size')).toHaveText('65')
  await expect(page.locator('.pages')).toHaveText(/^1 \//)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: true })

  test('taps turn pages and operate the menus, which fit the screen', async ({ page }) => {
    await page.goto('/app/?url=/samples/nepub.epub')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    const tap = async (x: number, y: number) => {
      await page.touchscreen.tap(x, y)
      await page.waitForTimeout(AFTER_INPUT)
    }
    await tap(40, 500) // the left side: next page
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await tap(350, 500)
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    expect((await page.locator('.title').boundingBox())!.width).toBeGreaterThan(80) // there is room for the title

    for (const menu of ['.settings', '.toc']) {
      await page.locator(`${menu} summary`).tap()
      const box = (await page.locator(`${menu} .panel`).boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(390)
      expect(box.y + box.height).toBeLessThanOrEqual(780)
    }
    await expect(page.locator('.settings .panel')).toBeHidden() // opening one menu closes the other
    await page.locator('.toc-list').getByRole('button', { name: '第2話　サンプル' }).tap()
    await expect.poll(() => heading(page)).toBe('第2話　サンプル')

    await page.locator('.settings summary').tap()
    await page.locator('.settings input[name=theme][value=sepia]').tap()
    await expect(page.locator('input[name=theme]:checked')).toHaveValue('sepia')
    await tap(40, 700) // closes the menu; the page stays
    await expect(page.locator('.settings .panel')).toBeHidden()
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
  })
})

test.describe('swipes on a touch screen', () => {
  test.use({ hasTouch: true })

  /** A touch that starts with `fingers` fingers; the first moves by (dx, dy) and is lifted. */
  async function swipe(page: Page, dx: number, dy = 0, fingers = 1): Promise<void> {
    const body = content(page).locator('body')
    const touch = (identifier: number, x: number, y: number) => ({ identifier, clientX: x, clientY: y, screenX: x, screenY: y })
    const start = [touch(0, 300, 300), touch(1, 500, 300)].slice(0, fingers)
    await body.dispatchEvent('touchstart', { touches: start, changedTouches: start, targetTouches: start })
    const rest = start.slice(1)
    await body.dispatchEvent('touchend', { touches: rest, changedTouches: [touch(0, 300 + dx, 300 + dy)], targetTouches: rest })
    await page.waitForTimeout(AFTER_INPUT)
  }

  /**
   * A real touch, which goes through the browser's own gesture handling (scrolling, zooming, turning
   * taps into clicks), unlike the events made by swipe(): a finger put down at (x, y), dragged by
   * (dx, dy) in steps, and lifted. Only Chromium lets tests inject one, through the DevTools Protocol.
   */
  async function drag(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
    const client = await page.context().newCDPSession(page)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= 8; i++) {
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * i) / 8, y: y + (dy * i) / 8 }] })
      await page.waitForTimeout(16)
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await client.detach()
    await page.waitForTimeout(AFTER_INPUT)
  }
  const chromiumOnly = (browserName: string) =>
    test.skip(browserName !== 'chromium', 'touch input can only be injected through the Chrome DevTools Protocol')

  test('turn the page the way the finger drags it', async ({ page }) => {
    await page.goto('/app/?url=/samples/nepub.epub')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    // Double taps (quick page turns by tapping) do not zoom; panning and pinch zoom are left alone.
    expect(await evaluate(page, () => getComputedStyle(document.documentElement).touchAction)).toBe('manipulation')
    await swipe(page, 100) // to the right: the page on the left, which is the next one in a vertical book
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await swipe(page, -100, 30)
    await expect(page.locator('.progress')).toHaveText(/^1 \//)

    await page.goto('/app/?url=/samples/general.epub')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await swipe(page, -100)
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
  })

  test('ignore touches that are not a sideways swipe with one finger', async ({ page }) => {
    await page.goto('/app/?url=/samples/nepub.epub')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await swipe(page, 20) // too short: a tap
    await swipe(page, 100, 90) // too steep: scrolling
    await swipe(page, 0, 200)
    await swipe(page, 100, 0, 2) // two fingers: a pinch
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await swipe(page, 100) // still works afterwards
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
  })

  test('work with real touch input, also next to taps and pinch zoom', async ({ page, browserName }) => {
    chromiumOnly(browserName)
    await page.goto('/app/?url=/samples/nepub.epub')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await drag(page, 500, 400, 200, 10) // swipe to the right: next page
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await drag(page, 500, 400, -200, -10)
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await drag(page, 500, 400, 10, 250) // vertical: nothing
    await drag(page, 500, 400, 0, -250)
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    await drag(page, 100, 400, 0, 0) // a tap on the left side still turns the page, once
    await expect(page.locator('.progress')).toHaveText(/^2 \//)
    await drag(page, 700, 60, -200, 0) // a swipe that starts on a paragraph at the top edge of the page
    await expect(page.locator('.progress')).toHaveText(/^1 \//)

    // Zoomed in with a pinch, a drag pans the zoomed page instead of turning it.
    const client = await page.context().newCDPSession(page)
    await client.send('Input.synthesizePinchGesture', { x: 640, y: 360, scaleFactor: 2 })
    expect(await page.evaluate(() => visualViewport!.scale)).toBeGreaterThan(1.5)
    // Even when dragged on beyond the edge of the page, where the finger moves over a page that stands still.
    await drag(page, 100, 400, 1100, 10)
    expect(await page.evaluate(() => visualViewport!.offsetLeft)).toBe(0) // panned all the way to the left edge
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
  })

  test('scrolling a host page with a finger on the viewer does not turn pages', async ({ page, browserName }) => {
    chromiumOnly(browserName)
    await page.goto('/app/')
    // A viewer in a box on a long page.
    await page.evaluate(async () => {
      const { EpubViewer, openBook } = await import('/dist/src/index.js' as string)
      document.body.style.cssText = 'height: auto; overscroll-behavior: auto'
      document.body.innerHTML = '<div id="box" style="width: 600px; height: 400px"></div><div style="height: 3000px"></div>'
      const viewer = new EpubViewer(document.getElementById('box')!)
      viewer.addEventListener('relocate', (e: CustomEvent) => (document.title = `page ${e.detail.page + 1}`))
      await viewer.open(await openBook('/samples/nepub.epub'))
    })
    await expect(page).toHaveTitle('page 1')
    await drag(page, 300, 350, 60, -300) // upwards, drifting sideways as a thumb does
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(100) // the page did scroll
    await expect(page).toHaveTitle('page 1')
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
