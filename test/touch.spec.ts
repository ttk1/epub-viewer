// Touch screens: taps, swipes, and the reader on a phone.
import { expect, test, type Page } from '@playwright/test'
import { content, evaluate, heading, AFTER_INPUT } from './helpers.ts'

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

  test('taps pick choices that were put into the settings menu later', async ({ page }) => {
    await page.goto('/app/')
    await page.evaluate(async () => {
      const { EpubReader } = await import('/dist/src/index.js' as string)
      const root = document.createElement('div')
      root.style.height = '100vh'
      document.body.replaceChildren(root)
      const reader = new EpubReader(root, { storageKey: 'touch-choices' })
      ;(window as any).reader = reader
      await reader.open('/samples/nepub.epub')
    })
    await page.locator('.settings summary').tap()
    // While the menu is open, as when the window changes its width.
    await page.evaluate(() => (window as any).reader.setChoices({ margin: [[35, '狭い'], [56, '標準'], [112, '広い']] }))
    await page.locator('.settings input[name=margin][value="56"]').tap()
    await expect(page.locator('input[name=margin]:checked')).toHaveValue('56')
    expect(await page.evaluate(() => [(window as any).reader.viewer.options.margin, localStorage.getItem('touch-choices:settings')])).toEqual([56, '{"margin":56}'])
    await expect(page.locator('.settings .panel')).toBeVisible()
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
