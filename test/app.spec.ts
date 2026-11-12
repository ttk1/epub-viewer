// The standalone app and the example: opening files, the keyboard on the toolbar, the series example.
import { expect, test, type Frame } from '@playwright/test'
import { readFileSync } from 'node:fs'
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
