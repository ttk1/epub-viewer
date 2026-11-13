/**
 * The colors and the font of reflowable text. The viewer gives the text those of the theme and of
 * the reader's choice; a book is made for a white page, and for fonts of its own. Here is where
 * the two meet: what of the book is kept as it is, and what of it is changed to be seen.
 */
import type { ViewerOptions } from './options.ts'

/** Marks an element that has a background of its own: it, and what is in it, keep the colors of the book. */
const OWN_COLORS = 'data-epub-viewer-colors'
/** Marks an element in a monospace font, which it keeps. */
const OWN_FONT = 'data-epub-viewer-font'
/** Its value where the book justifies the element like the text around it: a line of code that wraps would have its spaces stretched. */
const JUSTIFIED = 'justified'
/** Marks an element whose borders are drawn in a dark color: on a dark page, they take the color of the text. */
const DARK_BORDER = 'data-epub-viewer-border'
/**
 * Small images of characters that fonts do not have, by the class that the EBPAJ guide gives them:
 * black on white (or on nothing), in a line of text.
 */
const GLYPHS = 'img[class*="gaiji"]'

// Colors as browsers give them in computed styles.
/** The opacity: "rgba(r, g, b, a)", or "... / a)" in other notations. */
const alpha = (color: string) => Number(color.match(/^rgba\(.*,\s*([\d.]+)\)$/)?.[1] ?? color.match(/\/\s*([\d.]+)\)$/)?.[1] ?? 1)
/** How bright, from 0 to 1 (1 for a notation that is not read, or no color at all). */
const brightness = (color: string) => {
  const [r, g, b] = color.startsWith('rgb') ? (color.match(/[\d.]+/g) ?? []).map(Number) : []
  return b === undefined ? 1 : (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}
/** What cannot be seen on a dark page. Red, or a mid grey, can. */
const DARK = 0.2

/**
 * Finds what the viewer must not give its own colors and font, as it does to the rest of the text.
 * Once for a document, while the rules of the viewer are not in it: what is read is what the book says.
 *
 * - Text on a background that the book gives it. The background stays as it is, and the color of
 *   the theme can be unreadable on it: a heading in white on black became black on black, and
 *   code on light grey could not be read in a dark theme. A mere tint is not such a background.
 * - Code. The font of the reader's choice is for the text; in it, code is not told from the text.
 *
 * And what is drawn for a white page, and lost on a dark one: rules and frames in black (not those
 * on a background of the book, which are seen on it).
 */
export function keepBookStyles(doc: Document): void {
  // Every element of the book is gone through, so by the methods of Element itself: a <form> has
  // its controls as properties by their names, over its own (<input name="setAttribute">).
  const { getAttribute, setAttribute } = Element.prototype
  // All is read before anything is written: a style read after a change is worked out anew, for
  // each element (a second for a long chapter, in WebKit).
  const marks: [el: Element, attribute: string, value: string][] = []
  /** The elements that have a background of their own, and those inside them (a parent comes before its children). */
  const onOwnBackground = new Set<Element | null>()
  for (const el of doc.body?.querySelectorAll('*') ?? []) {
    const style = doc.defaultView!.getComputedStyle(el)
    if (alpha(style.backgroundColor) >= 0.5) {
      onOwnBackground.add(el)
      // The color of the book, where the theme's would be inherited. Before what the book has
      // there, which may not be well-formed.
      marks.push([el, OWN_COLORS, ''], [el, 'style', `color:${style.color} !important;${getAttribute.call(el, 'style') ?? ''}`])
    } else if (onOwnBackground.has(el.parentElement)) {
      onOwnBackground.add(el)
    } else {
      const borders = (['Top', 'Right', 'Bottom', 'Left'] as const).filter((side) => parseFloat(style[`border${side}Width`]) > 0 && alpha(style[`border${side}Color`]) >= 0.5)
      if (borders.length && borders.every((side) => brightness(style[`border${side}Color`]) < DARK)) marks.push([el, DARK_BORDER, ''])
    }
    if (/\bmonospace\b/.test(style.fontFamily)) marks.push([el, OWN_FONT, style.textAlign === 'justify' ? JUSTIFIED : ''])
  }
  for (const [el, attribute, value] of marks) setAttribute.call(el, attribute, value)
}

/** The rules that give the text the colors of the theme and the font chosen, but for what keepBookStyles() has marked. */
export function lookRules({ theme, fontFamily }: ViewerOptions): string {
  const onOwnBackground = `[${OWN_COLORS}], [${OWN_COLORS}] *`
  return `
    html {
      color: ${theme.color} !important;
      /* Not transparent: browsers paint an opaque (white) backdrop behind an iframe whose
         color-scheme differs from the host page's, e.g. a dark host page. */
      background: ${theme.background} !important;
    }
    /* The colors of the page are the theme's. With the color too: a book that sets both on
       <body> (black on white) would be left with its black on a dark page. */
    body { background: transparent !important; color: inherit !important; }
    ${fontFamily ? `body, body :not([${OWN_FONT}]) { font-family: ${fontFamily} !important; }` : ''}
    [${OWN_FONT}="${JUSTIFIED}"] { text-align: start !important; }
    body :not(a):not(${onOwnBackground}) {
      color: inherit !important;
      /* What is drawn with the text, in a color that the book may set apart from it. */
      -webkit-text-emphasis-color: currentcolor !important;
      text-emphasis-color: currentcolor !important;
      text-decoration-color: currentcolor !important;
    }
    :is(a:link, a:visited):not(${onOwnBackground}) { color: ${theme.link} !important; }
    /* The white around a character does not show on a page of another color (e.g. sepia). */
    ${GLYPHS} { mix-blend-mode: multiply !important; }`
}

/**
 * More rules for a page that is dark, once lookRules() are in the document. What the book draws in
 * black for a white page is lost on it: borders take the color of the text, and images of
 * characters are turned to white on black, of which only the white shows.
 */
export function darkPageRules(doc: Document): string {
  // The color of a theme is any CSS color: it is read as the browser has resolved it.
  if (brightness(doc.defaultView!.getComputedStyle(doc.documentElement).backgroundColor) >= 0.5) return ''
  return `
    [${DARK_BORDER}] { border-color: currentcolor !important; }
    ${GLYPHS}:not([${OWN_COLORS}] *) { filter: invert(1) !important; mix-blend-mode: screen !important; }`
}
