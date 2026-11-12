// Horizontal text in the standalone app: an EPUB 2 book with broken and hostile content.
import { expect, test } from '@playwright/test'
import { content, evaluate, heading, pageCount, press, click, collectAlerts, openSettings, setting, chooseChapter } from './helpers.ts'

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

    await press(page, 'Escape') // the settings menu: keys do not turn the page behind it
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
    // The image is an SVG, which gets a data: URL (see the next test).
    for (const url of urls) expect(url).toMatch(/^(url\(")?data:image\/svg\+xml/)
    expect(await evaluate(page, () => (document.getElementById('srcset') as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  })

  test('gives files that can hold scripts a URL that does not have the origin of the page', async ({ page }) => {
    // Opened as a page of its own (e.g. "open image in new tab"), an SVG with a blob: URL would run its scripts as the host.
    const cover = await evaluate(page, () => (document.getElementById('cover') as HTMLImageElement).src)
    expect(cover).toMatch(/^data:image\/svg\+xml/)
    // What cannot hold scripts keeps the cheaper blob: URL.
    await page.goto('/app/?url=/samples/nepub.epub')
    await expect(page.locator('.progress')).toHaveText(/^1 \//)
    expect(await evaluate(page, () => document.querySelector('img')!.src)).toMatch(/^blob:/)
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
  for (const target of ['probe', 'nohead', 'svgroot', 'xslt', 'charset']) {
    test(`does not run scripts in a hostile spine item (${target})`, async ({ page }) => {
      await content(page).locator(`#to-${target}`).click()
      await page.waitForTimeout(1000)
      expect(await page.evaluate(() => document.body.dataset.hacked)).toBeUndefined()
    })
  }

  test('does not run scripts in a file that the manifest lists twice, as different kinds', async ({ page }) => {
    await content(page).locator('#to-dup').click()
    await expect.poll(() => heading(page)).toBe('Dup')
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => document.body.dataset.hacked)).toBeUndefined()
  })

  // Each of these would take the frame to another page (here: an empty one) by itself.
  for (const [target, title, act] of [
    ['noscript', 'Noscript', undefined],
    ['shadow', 'Shadow', '#host'],
    ['links', 'Links', '#animated-link'],
  ] as const) {
    test(`does not let the book leave the frame (${target})`, async ({ page }) => {
      await content(page).locator(`#to-${target}`).click()
      await expect.poll(() => heading(page)).toBe(title)
      if (act) await content(page).locator(act).click()
      await page.waitForTimeout(1000)
      expect(await heading(page)).toBeDefined() // still a page of the book (a click may have turned the page)
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
