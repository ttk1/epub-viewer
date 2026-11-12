import { expect, test } from '@playwright/test'
import type { Section } from '../src/book.ts'
import { fitScale, pairPages, twoPages } from '../src/fixed.ts'

/** Sections of a book: "L" / "R" / "C" for a page that says its side, "-" for one that does not, "x" for one that is not linear. */
const sections = (pages: string): Section[] =>
  [...pages].map((page, index) => ({
    href: `p${index}.xhtml`,
    linear: page !== 'x',
    size: 1,
    spread: ({ L: 'left', R: 'right', C: 'center' } as const)[page],
  }))

test('shows pages one by one without a spread, leaving out those that are not linear', () => {
  expect(pairPages(sections('--x-'), 'rtl', false)).toEqual([[0], [1], [3]])
})

test('pairs pages by the sides that the book gives, the first on the side that the book starts from', () => {
  // Read from right to left: a pair is a right page followed by a left page.
  expect(pairPages(sections('CRLRLR'), 'rtl', true)).toEqual([[0], [1, 2], [3, 4], [5]])
  expect(pairPages(sections('LRLRL'), 'rtl', true)).toEqual([[0], [1, 2], [3, 4]]) // begins on the second side
  expect(pairPages(sections('RRLL'), 'rtl', true)).toEqual([[0], [1, 2], [3]]) // two pages for the same side do not pair
  expect(pairPages(sections('RLCRL'), 'rtl', true)).toEqual([[0, 1], [2], [3, 4]]) // a page across both sides stands alone
  // Read from left to right, it is the other way round.
  expect(pairPages(sections('CLRLR'), 'ltr', true)).toEqual([[0], [1, 2], [3, 4]])
  expect(pairPages(sections('RLR'), 'ltr', true)).toEqual([[0], [1, 2]])
})

test('where the book gives no sides, the cover stands alone and the rest go in pairs', () => {
  expect(pairPages(sections('-----'), 'rtl', true)).toEqual([[0], [1, 2], [3, 4]])
  expect(pairPages(sections('------'), 'ltr', true)).toEqual([[0], [1, 2], [3, 4], [5]])
  expect(pairPages(sections('-x--'), 'rtl', true)).toEqual([[0], [2, 3]])
  expect(pairPages(sections('--R'), 'rtl', true)).toEqual([[0], [1], [2]]) // the page after the cover waits for a left page in vain
})

test('shows two pages where there is room, unless told otherwise', () => {
  expect(twoPages(1280, 720, 'auto')).toBe(true)
  expect(twoPages(720, 1280, 'auto')).toBe(false)
  expect(twoPages(720, 1280, 'always')).toBe(true)
  expect(twoPages(1280, 720, 'never')).toBe(false)
})

test('scales pages to fit side by side', () => {
  expect(fitScale([[600, 900]], 1200, 900)).toBe(1) // limited by the height
  expect(fitScale([[600, 900]], 300, 900)).toBe(0.5) // limited by the width
  expect(fitScale([[600, 900], [600, 900]], 600, 900)).toBe(0.5) // two pages need twice the width
  expect(fitScale([[600, 900], [600, 450]], 2400, 1800)).toBe(2) // the taller page decides
})
