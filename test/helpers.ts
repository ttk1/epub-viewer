// Helpers shared by the tests: getting at the page of the book, and operating the reader as a user would.
import { type Page } from '@playwright/test'
import { inflateSync } from 'node:zlib'

/** The iframe that shows the current section. */
export const content = (page: Page) => page.frame({ url: /^blob:/ })!
export const evaluate = async <T>(page: Page, fn: () => T) => content(page).evaluate(fn)
// Polled while the iframe may be navigating, so evaluation errors are treated as "not yet".
export const heading = (page: Page) =>
  evaluate(page, () => document.querySelector('h1, h2')?.textContent).catch(() => undefined)
/** RGB of the rendered pixel at (x, y), read from a 1×1 PNG screenshot. */
export async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, scale: 'css' })
  const idat: Buffer[] = []
  for (let p = 8; p < png.length; p += 12 + png.readUInt32BE(p)) {
    if (png.toString('ascii', p + 4, p + 8) === 'IDAT') idat.push(png.subarray(p + 8, p + 8 + png.readUInt32BE(p)))
  }
  return [...inflateSync(Buffer.concat(idat)).subarray(1, 4)] // [filter, r, g, b, (a)]
}
// Check rendered pixels: computed styles alone missed a white iframe backdrop in dark mode.
export const LIGHT = [255, 255, 255]
export const DARK = [0, 0, 0]
export async function pageBackground(page: Page): Promise<number[]> {
  const box = (await page.locator('iframe').boundingBox())!
  return pixel(page, box.x + 4, box.y + box.height - 4) // inside the page margin
}
export const pageCount = async (page: Page) =>
  Number((await page.locator('.progress').textContent())!.match(/\/ (\d+)/)![1])

// User page turns closer together than the viewer's cooldown (100 ms) are dropped as chattering,
// so wait a little after each one.
export const AFTER_INPUT = 150
export async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key)
  await page.waitForTimeout(AFTER_INPUT)
}
export async function click(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y)
  await page.waitForTimeout(AFTER_INPUT)
}

/** The messages of the alert() dialogs from now on: the app shows the errors of the viewer with them. */
export function collectAlerts(page: Page): string[] {
  const messages: string[] = []
  page.on('dialog', (dialog) => {
    messages.push(dialog.message())
    void dialog.dismiss()
  })
  return messages
}
export async function openSettings(page: Page): Promise<void> {
  if ((await page.locator('.settings[open]').count()) === 0) await page.locator('.settings summary').click()
}
/** Picks a value in the settings menu. */
export async function setting(page: Page, name: string, value: string): Promise<void> {
  await openSettings(page)
  await page.locator(`.settings input[name=${name}][value="${value}"]`).check()
}
export async function chooseChapter(page: Page, label: string): Promise<void> {
  await page.locator('.toc summary').click()
  await page.locator('.toc-list').getByRole('button', { name: label, exact: true }).click()
}
