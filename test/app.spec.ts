// The standalone app and the example: opening files, the keyboard on the toolbar, the series example.
import { expect, test, type Frame } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { content, heading, press } from './helpers.ts'

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
  // Nor do the keys that turn pages reach the page behind the open menu.
  await press(page, 'ArrowDown')
  await press(page, 'ArrowLeft')
  await expect(page.locator('.pages')).toHaveText(/^1 \//)
  await expect(page.locator('.settings .panel')).toBeVisible()
})

test('a menu opened with the mouse is closed by Escape, and keys do not turn the page behind it', async ({ page }) => {
  await page.goto('/app/?url=/samples/nepub.epub')
  await expect(page.locator('.progress')).toHaveText(/^1 \//)
  await page.locator('.settings summary').click() // the focus does not stay in the toolbar after a click
  await expect(page.locator('.settings .panel')).toBeVisible()
  await press(page, 'ArrowLeft')
  await press(page, 'Space')
  await expect(page.locator('.pages')).toHaveText(/^1 \//)
  await press(page, 'Escape')
  await expect(page.locator('.settings .panel')).toBeHidden()
  await press(page, 'ArrowLeft') // and the keys turn pages again
  await expect(page.locator('.pages')).toHaveText(/^2 \//)
})

test('the page around the reader has the background of the theme', async ({ page }) => {
  // What a phone shows behind its status bar and the bars of the browser.
  const background = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/app/') // before a book is open, too
  expect(await background()).toBe('rgb(0, 0, 0)')
  await page.emulateMedia({ colorScheme: 'light' }) // the theme follows the OS
  await expect.poll(background).toBe('rgb(255, 255, 255)')
  await page.locator('.settings summary').click()
  await page.locator('.settings input[name=theme][value=sepia]').check()
  expect(await background()).toBe('rgb(244, 236, 216)')
  await page.reload() // the saved theme
  expect(await background()).toBe('rgb(244, 236, 216)')
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

// The demo site, as it is published: put together by scripts/make-site.js, under a path of its own.
test('the demo site opens its sample books from its index page', async ({ page }) => {
  await page.goto('/site/')
  await page.getByRole('link', { name: '縦書きの小説' }).click()
  await expect(page.locator('.title')).toHaveText('縦書きサンプル')
  await expect(page.locator('.progress')).toHaveText(/^1 \/ \d+/)
  expect(await content(page).evaluate(() => getComputedStyle(document.documentElement).writingMode)).toBe('vertical-rl')
  await page.goto('/site/')
  await page.getByRole('link', { name: '漫画' }).click()
  await expect(page.locator('.progress')).toHaveText(/^1 \/ 6/)
})

test('the demo site holds only what it shows', () => {
  const files = readdirSync('site', { recursive: true }).map(String).sort()
  expect(files.filter((file) => file.endsWith('.epub'))).toEqual(['samples/fixed.epub', 'samples/novel.epub']) // not the book with hostile content
  expect(files.filter((file) => /\.(ts|map)$/.test(file))).toEqual([])
  // Nor the name of the tool that the format of the novel comes from: the demo is of the viewer.
  for (const file of files.filter((file) => /\.(html|js|css)$/.test(file))) expect(readFileSync(`site/${file}`, 'utf8'), file).not.toMatch(/nepub/i)
})
