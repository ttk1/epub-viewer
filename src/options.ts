export interface Theme {
  background: string
  color: string
  link: string
}

export const themes = {
  light: { background: '#ffffff', color: '#1a1a1a', link: '#1a5fb4' },
  // Grey rather than white text: full white is glaring on a black page.
  dark: { background: '#000000', color: '#acacac', link: '#7fa3d9' },
  sepia: { background: '#f4ecd8', color: '#5b4636', link: '#8a4b08' },
} satisfies Record<string, Theme>

/**
 * Font stacks for Japanese text, covering macOS / iOS, Windows, Android and Linux.
 * Meiryo comes after Yu Gothic: its tall line metrics push ruby away from vertical text.
 */
export const fonts = {
  mincho:
    '"Hiragino Mincho ProN", "Yu Mincho", YuMincho, "BIZ UDMincho", "Noto Serif JP", "Noto Serif CJK JP", "IPAexMincho", "IPAMincho", serif',
  gothic:
    '"Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic Medium", "Yu Gothic", YuGothic, Meiryo, "Noto Sans JP", "Noto Sans CJK JP", "IPAexGothic", "IPAGothic", sans-serif',
}

export interface ViewerOptions {
  // ---- How the book looks. The first group only applies to reflowable text, not to fixed-layout pages.
  theme: Theme
  /** CSS font-family that overrides the book's fonts, e.g. `fonts.mincho`. "" keeps the book's fonts. */
  fontFamily: string
  /** Base font size in CSS px. Text sized relatively (em, %) by the book scales with it. */
  fontSize: number
  /** Line height of the text as a multiple of the font size, overriding the book's. 0 keeps the book's (1.6 where it sets none). */
  lineHeight: number
  /** "auto" follows the book's CSS. */
  writingMode: 'auto' | 'vertical' | 'horizontal'
  /** Page margin in CSS px. */
  margin: number
  /** Maximum page width in CSS px, centered in the container (0 = full width). Wide lines of text tire the eyes. */
  maxWidth: number
  /**
   * Two pages side by side: for fixed-layout books (e.g. manga) two pages, for horizontal text two
   * columns. "auto" does so when there is room: a container wider than tall, or wide enough for
   * two columns of text. Vertical text is not affected: its page already uses the whole width.
   */
  spread: 'auto' | 'always' | 'never'
  /**
   * Fixed layout: the side that pages progress towards, "rtl" for a book opened from the right
   * (manga). "auto" follows the book; give it for books that are made without saying.
   */
  direction: 'auto' | 'ltr' | 'rtl'

  // ---- What turns pages. Turn any of them off to handle that kind of input yourself.
  /** Turn pages with ←/→, ↑/↓, PageUp/PageDown and Space pressed anywhere in the host window. */
  keyboard: boolean
  /** Turn pages with clicks / taps on the left and right thirds of the page. Links in the book work either way. */
  click: boolean
  /** Turn pages with the mouse wheel / trackpad over the viewer: one page per wheel gesture. */
  wheel: boolean
  /** Turn pages with sideways swipes on touch screens. */
  swipe: boolean
  /**
   * Page turns by any of these within this many ms of the one before are ignored, so that
   * chattering (e.g. of remote controls) does not skip pages. Keep it short, for fast deliberate presses.
   */
  cooldown: number
}

export const DEFAULT_OPTIONS: ViewerOptions = {
  theme: themes.light,
  fontFamily: '',
  fontSize: 16,
  lineHeight: 0,
  writingMode: 'auto',
  margin: 32,
  maxWidth: 0,
  spread: 'auto',
  direction: 'auto',
  keyboard: true,
  click: true,
  wheel: true,
  swipe: true,
  cooldown: 100,
}
