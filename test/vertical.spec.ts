// Vertical text in the standalone app: the sample in the format of nepub.
import { expect, test } from '@playwright/test'
import { evaluate, heading, pixel, LIGHT, DARK, pageBackground, pageCount, AFTER_INPUT, press, click, openSettings, setting, chooseChapter } from './helpers.ts'

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

  test('the slider under the toolbar shows the place in the book, and goes to another', async ({ page }) => {
    const seek = page.locator('.seek')
    const value = async () => Number(await seek.inputValue())
    await expect(seek).toHaveAttribute('dir', 'rtl') // from the right, the way the pages go
    const start = await value()
    await press(page, 'ArrowLeft')
    expect(await value()).toBeGreaterThan(start)

    // With the focus on the slider, the keys still turn one page (left to the browser, they would
    // move it by a step of its own: the whole book, in one of them).
    await seek.focus()
    const focused = await value()
    await press(page, 'ArrowLeft')
    expect(await value()).toBeGreaterThan(focused)
    expect(await value()).toBeLessThan(focused + 0.05)
    expect(await page.evaluate(() => document.activeElement?.className)).toBe('seek')

    await seek.fill('0.6') // as a drag does
    await expect.poll(value).toBeGreaterThanOrEqual(0.6) // the end of the page that this much of the book falls on
    expect(await value()).toBeLessThan(0.65)
    await expect(page.locator('.percent')).toHaveText(/（6\d%）/)

    // Only the thumb takes the pointer: a click elsewhere on the line does not move it (nor does a
    // touch near it, which is how a swipe at the top of the page lost the place).
    const box = (await seek.boundingBox())!
    const y = box.y + box.height / 2
    const before = await value()
    await page.mouse.click(box.x + box.width * 0.75, y)
    await page.waitForTimeout(AFTER_INPUT)
    expect(await value()).toBe(before)

    // The thumb dragged with the mouse, to a quarter of the way from the right. The keys turn pages again after it.
    const thumb = 28
    await page.mouse.move(box.x + box.width - thumb / 2 - before * (box.width - thumb), y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.75, y, { steps: 5 })
    // While it is held, the numbers follow it: the share of the book (the pages of text there are not known yet).
    await expect(page.locator('.progress')).toHaveText(/^2\d%$/)
    await page.mouse.up()
    await expect(page.locator('.progress')).toHaveText(/^\d+ \/ \d+（2\d%）$/)
    await expect.poll(value).toBeLessThan(0.3)
    const dragged = await value()
    expect(dragged).toBeGreaterThan(0.2)
    expect(await page.evaluate(() => document.activeElement?.className)).not.toBe('seek')
    await press(page, 'ArrowLeft')
    expect(await value()).toBeGreaterThan(dragged)
  })

  test('the line of the slider is filled up to its thumb, wherever that is', async ({ page }) => {
    // The thumb stays inside the toolbar, so it moves by less than the width of the line. Filled by
    // the share of its whole width, the line came out on the far side of the thumb near the end.
    const seek = page.locator('.seek')
    const box = (await seek.boundingBox())!
    const y = Math.floor(box.y + box.height / 2) // on the line
    const filled = async (x: number) => (await pixel(page, x, y))[0] < 100 // the color of the text, on white
    for (const fraction of [0, 0.5, 0.9, 1]) {
      await seek.fill(String(fraction))
      await page.waitForTimeout(300) // the move is over: the thumb and the line are where the page is
      // The middle of the thumb (a dot of 12px in a box of 28px), from the right.
      const travelled = Number(await seek.inputValue()) * (box.width - 28) // not 0 at the start: the place is the end of the first page
      const thumb = box.x + box.width - 14 - travelled
      expect([fraction, await filled(thumb + 10), await filled(thumb - 10)]).toEqual([fraction, travelled > 10, false])
    }
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

  test('shows the setting for spreads only where it does something: not for vertical text', async ({ page }) => {
    await openSettings(page)
    await expect(page.locator('.settings .row:visible > :first-child')).toHaveText(['文字サイズ', 'フォント', '行間', '表示幅', '余白', '表示方向', 'テーマ'])
    await setting(page, 'writingMode', 'horizontal')
    await expect(page.locator('.settings .row:visible > :first-child')).toHaveText(['文字サイズ', 'フォント', '行間', '表示幅', '余白', '表示方向', '見開き', 'テーマ'])
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

  test('changes the page margin, and keeps the choice', async ({ page }) => {
    const padding = () => evaluate(page, () => getComputedStyle(document.documentElement).padding)
    await expect(page.locator('input[name=margin]:checked')).toHaveValue('32')
    expect(await padding()).toBe('32px')
    const before = await pageCount(page)
    await setting(page, 'margin', '96')
    expect(await padding()).toBe('96px')
    expect(await pageCount(page)).toBeGreaterThan(before) // less room for the text
    await page.reload()
    await expect(page.locator('.progress')).toHaveText(/\d+ \/ \d+/)
    expect(await padding()).toBe('96px')
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
