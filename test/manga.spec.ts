// Fixed-layout books in the standalone app: pages scaled to fit, and spreads.
import { expect, test, type Page } from '@playwright/test'
import { evaluate, press, click, openSettings, setting, chooseChapter } from './helpers.ts'

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
    expect(await evaluate(page, () => [innerWidth, innerHeight, document.querySelector('svg image')!.getBoundingClientRect().width])).toEqual([600, 900, 600])

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
