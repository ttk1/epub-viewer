import { resolvePath, type Book } from './book.ts'

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
  theme: Theme
  /** CSS font-family that overrides the book's fonts, e.g. `fonts.mincho`. "" keeps the book's fonts. */
  fontFamily: string
  /** Base font size in CSS px. Text sized relatively (em, %) by the book scales with it. */
  fontSize: number
  /** "auto" follows the book's CSS. */
  writingMode: 'auto' | 'vertical' | 'horizontal'
  /** Page margin in CSS px. */
  margin: number
  /** Maximum page width in CSS px, centered in the container (0 = full width). Wide lines of text tire the eyes. */
  maxWidth: number
  /** Turn pages with ←/→, PageUp/PageDown and Space pressed anywhere in the host window. */
  keyboard: boolean
  /**
   * Page-turn keys and clicks within this many ms of the previous accepted one are ignored, so that
   * chattering (e.g. remote controls) does not skip pages. Keep it short so fast deliberate presses still work.
   */
  cooldown: number
}

/** A position that survives re-layout (font size / window size changes). */
export interface Location {
  /** Index into `book.sections`. */
  index: number
  /** Position within the section, 0 (first page) to 1 (last page). */
  progress: number
}

export interface RelocateDetail extends Location {
  /** 0-based page number within the section. */
  page: number
  /** Number of pages in the section. */
  pages: number
  /** Estimated progress through the whole book, (0, 1]; 1 on the last page. */
  fraction: number
}

export interface EpubViewerEventMap {
  /** The displayed page changed. */
  relocate: CustomEvent<RelocateDetail>
  /** next() was called on the last page of the book. */
  bookend: Event
  /** prev() was called on the first page of the book. */
  bookstart: Event
  /** A section document was loaded, before layout. Use it to inject styles or listeners. */
  sectionload: CustomEvent<{ index: number; doc: Document }>
  /** An external http(s): / mailto: link was clicked. Call preventDefault() to stop it from opening in a new tab. */
  link: CustomEvent<{ href: string }>
}

// Typed addEventListener / removeEventListener overloads.
export interface EpubViewer {
  addEventListener<K extends keyof EpubViewerEventMap>(
    type: K,
    listener: (event: EpubViewerEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void
  removeEventListener<K extends keyof EpubViewerEventMap>(
    type: K,
    listener: (event: EpubViewerEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void
}

const DEFAULTS: ViewerOptions = {
  theme: themes.light,
  fontFamily: '',
  fontSize: 16,
  writingMode: 'auto',
  margin: 32,
  maxWidth: 0,
  keyboard: true,
  cooldown: 100,
}

/**
 * Paginated EPUB renderer. Each section is shown in an iframe (scripts disabled) and split into
 * pages with CSS multi-column layout. For vertical text the columns stack downwards, so a page
 * turn is a vertical scroll; for horizontal text it is a horizontal scroll.
 */
export class EpubViewer extends EventTarget {
  book?: Book
  readonly #container: HTMLElement
  readonly #iframe: HTMLIFrameElement
  readonly #options: ViewerOptions = { ...DEFAULTS }
  readonly #resizeObserver = new ResizeObserver(() => this.#relayout())
  #style?: HTMLStyleElement
  /** writing-mode declared by the book for the current section. */
  #bookWritingMode = 'horizontal-tb'
  /** writing-mode actually used for layout. */
  #writingMode = 'horizontal-tb'
  #index = -1
  #page = 0
  #pages = 1
  /** Page size along the scroll axis, in px. */
  #pageSize = 0
  /** Incremented on every navigation, so that stale async loads can be discarded. */
  #token = 0
  #busy = false
  readonly #pressedKeys = new Set<string>()
  #lastInputTurn = -Infinity

  /** `container` must have a size (e.g. width/height set by CSS); the viewer fills it. */
  constructor(container: HTMLElement, options: Partial<ViewerOptions> = {}) {
    super()
    this.#container = container
    this.#iframe = container.ownerDocument.createElement('iframe')
    // allow-same-origin: the viewer styles the document and listens to its events.
    // allow-scripts: WebKit does not fire our event listeners without it. The book's own
    // scripts are still blocked by the CSP that Book inserts into every document.
    this.#iframe.sandbox.add('allow-same-origin', 'allow-scripts')
    this.#iframe.style.cssText = 'display:block;width:100%;height:100%;margin:0 auto;border:0'
    container.append(this.#iframe)
    container.addEventListener('click', this.#onSideClick)
    this.setOptions(options)
    this.#resizeObserver.observe(container)
    this.#listenKeys(this.#window, 'addEventListener')
  }

  get options(): Readonly<ViewerOptions> {
    return this.#options
  }

  /** Current position, to be saved and passed to `open()` / `goTo()` later. */
  get location(): Location | undefined {
    return this.#index < 0 ? undefined : { index: this.#index, progress: this.#page / this.#pages }
  }

  /** Shows `book` at `location` (a Location or a TocItem href), or at the beginning. */
  async open(book: Book, location?: Location | string): Promise<void> {
    this.book = book
    this.#index = -1
    await this.goTo(location ?? { index: Math.max(0, book.sections.findIndex((s) => s.linear)), progress: 0 })
  }

  async goTo(target: Location | string): Promise<void> {
    if (typeof target !== 'string') return this.#display(target.index, { progress: target.progress })
    const [path, fragment] = target.split('#')
    const index = this.book?.sections.findIndex((s) => s.href === path) ?? -1
    if (index >= 0) await this.#display(index, { fragment })
  }

  next(): Promise<void> {
    return this.#turn(1)
  }

  prev(): Promise<void> {
    return this.#turn(-1)
  }

  /** Page turn towards the left: next page for right-to-left (vertical) books, previous otherwise. */
  goLeft(): Promise<void> {
    return this.#turn(this.#rtl ? 1 : -1)
  }

  goRight(): Promise<void> {
    return this.#turn(this.#rtl ? -1 : 1)
  }

  setOptions(options: Partial<ViewerOptions>): void {
    Object.assign(this.#options, options)
    const { theme, maxWidth } = this.#options
    this.#container.style.background = theme.background
    this.#iframe.style.maxWidth = maxWidth > 0 ? `${maxWidth}px` : ''
    this.#relayout()
  }

  destroy(): void {
    this.#token++
    this.#resizeObserver.disconnect()
    this.#listenKeys(this.#window, 'removeEventListener')
    this.#container.removeEventListener('click', this.#onSideClick)
    this.#iframe.remove()
  }

  /** Key handling for a window: the host page's, or a section document's (keys there don't reach the host). */
  #listenKeys(target: Window, method: 'addEventListener' | 'removeEventListener'): void {
    target[method]('keydown', this.#onKeydown as EventListener)
    target[method]('keyup', this.#onKeyup as EventListener)
    target[method]('blur', this.#onBlur)
  }

  get #window(): Window {
    return this.#container.ownerDocument.defaultView!
  }

  get #vertical(): boolean {
    return this.#writingMode.startsWith('vertical')
  }

  get #rtl(): boolean {
    return this.#writingMode === 'vertical-rl'
  }

  async #turn(step: 1 | -1): Promise<void> {
    const sections = this.book?.sections
    if (!sections || this.#busy || this.#index < 0) return
    const page = this.#page + step
    if (page >= 0 && page < this.#pages) return this.#showPage(page)
    let index = this.#index + step
    while (sections[index] && !sections[index].linear) index += step
    if (sections[index]) return this.#display(index, { progress: step > 0 ? 0 : 1 })
    this.dispatchEvent(new Event(step > 0 ? 'bookend' : 'bookstart'))
  }

  async #display(index: number, { progress = 0, fragment }: { progress?: number; fragment?: string }): Promise<void> {
    const section = this.book?.sections[index]
    if (!section) return
    const token = ++this.#token
    this.#busy = true
    try {
      if (index !== this.#index) {
        this.#index = -1
        const doc = await this.#load(await this.book!.getUrl(section.href))
        if (token !== this.#token) return // superseded by a newer navigation
        this.#index = index
        this.#setup(doc)
      }
      this.#layout()
      this.#showPage(fragment ? this.#pageOf(fragment) : Math.round(progress * this.#pages))
      this.#iframe.style.visibility = ''
    } finally {
      if (token === this.#token) this.#busy = false
    }
  }

  #load(url: string): Promise<Document> {
    const iframe = this.#iframe
    iframe.style.visibility = 'hidden'
    return new Promise((resolve) => {
      const onLoad = async () => {
        const doc = iframe.contentDocument
        if (!doc || doc.URL === 'about:blank') return
        iframe.removeEventListener('load', onLoad)
        await doc.fonts.ready
        resolve(doc)
      }
      iframe.addEventListener('load', onLoad)
      iframe.src = url
    })
  }

  #setup(doc: Document): void {
    this.#bookWritingMode = doc.defaultView!.getComputedStyle(doc.body ?? doc.documentElement).writingMode
    this.#style = doc.createElement('style')
    ;(doc.head ?? doc.documentElement).append(this.#style)
    this.#listenKeys(doc.defaultView!, 'addEventListener')
    doc.addEventListener('click', this.#onClick)
    this.dispatchEvent(new CustomEvent('sectionload', { detail: { index: this.#index, doc } }))
  }

  /** Applies options to the current document and recomputes the page count. */
  #layout(): void {
    const doc = this.#iframe.contentDocument
    if (!doc || !this.#style) return
    const { theme, fontFamily, fontSize, writingMode, margin: m } = this.#options
    const { width, height } = this.#iframe.getBoundingClientRect()
    const [w, h] = [Math.floor(width), Math.floor(height)]
    this.#writingMode =
      writingMode === 'auto' ? this.#bookWritingMode : writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb'
    this.#pageSize = this.#vertical ? h : w
    // The html element is the multi-column container. Padding m + column gap 2m makes every
    // column (= page) start exactly at a multiple of the page size.
    this.#style.textContent = `
      html { line-height: 1.6; } /* default only; the book's own CSS wins */
      html {
        writing-mode: ${this.#writingMode} !important;
        box-sizing: border-box !important;
        width: ${w}px !important;
        height: ${h}px !important;
        margin: 0 !important;
        padding: ${m}px !important;
        column-width: ${this.#pageSize - 2 * m}px !important;
        column-gap: ${2 * m}px !important;
        column-fill: auto !important;
        overflow: hidden !important;
        font-size: ${fontSize}px !important;
        color: ${theme.color} !important;
        /* Not transparent: browsers paint an opaque (white) backdrop behind an iframe whose
           color-scheme differs from the host page's, e.g. a dark host page. */
        background: ${theme.background} !important;
      }
      body {
        writing-mode: ${this.#writingMode} !important;
        margin: 0 !important;
        background: transparent !important;
      }
      ${fontFamily ? `body, body * { font-family: ${fontFamily} !important; }` : ''}
      body :not(a) { color: inherit !important; }
      a:link, a:visited { color: ${theme.link} !important; }
      img, svg, video {
        max-width: ${w - 2 * m}px !important;
        max-height: ${h - 2 * m}px !important;
        object-fit: contain;
        break-inside: avoid;
      }`
    const scroller = doc.scrollingElement!
    const scrollSize = this.#vertical ? scroller.scrollHeight : scroller.scrollWidth
    this.#pages = Math.max(1, Math.ceil((scrollSize - m) / this.#pageSize))
  }

  #relayout(): void {
    if (this.#busy || this.#index < 0) return
    const progress = this.#page / this.#pages
    this.#layout()
    this.#showPage(Math.round(progress * this.#pages))
  }

  #showPage(page: number): void {
    const doc = this.#iframe.contentDocument!
    this.#page = Math.min(Math.max(page, 0), this.#pages - 1)
    const offset = this.#page * this.#pageSize
    doc.scrollingElement!.scrollTo(this.#vertical ? 0 : offset, this.#vertical ? offset : 0)

    const sizes = this.book!.sections.map((s) => s.size)
    const total = sizes.reduce((a, b) => a + b, 0) || 1
    const before = sizes.slice(0, this.#index).reduce((a, b) => a + b, 0)
    const detail: RelocateDetail = {
      ...this.location!,
      page: this.#page,
      pages: this.#pages,
      fraction: (before + (sizes[this.#index] * (this.#page + 1)) / this.#pages) / total,
    }
    this.dispatchEvent(new CustomEvent('relocate', { detail }))
  }

  #pageOf(id: string): number {
    const doc = this.#iframe.contentDocument!
    const el = doc.getElementById(id)
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    const scroller = doc.scrollingElement!
    const offset = this.#vertical ? rect.top + scroller.scrollTop : rect.left + scroller.scrollLeft
    return Math.floor(offset / this.#pageSize)
  }

  #onKeydown = (e: KeyboardEvent): void => {
    if (!this.#options.keyboard || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
    if ((e.target as Element).closest?.('input, textarea, select, [contenteditable]')) return
    const actions: Record<string, () => Promise<void>> = {
      ArrowLeft: this.goLeft,
      ArrowRight: this.goRight,
      PageUp: this.prev,
      PageDown: this.next,
      ' ': e.shiftKey ? this.prev : this.next,
    }
    const action = actions[e.key]
    if (!action) return
    e.preventDefault()
    // One press, one page: ignore auto-repeat while the key is held. Tracked here instead of
    // `e.repeat` because some remote controls send repeats without setting it.
    if (this.#pressedKeys.has(e.key)) return
    this.#pressedKeys.add(e.key)
    this.#inputTurn(action)
  }

  #onKeyup = (e: KeyboardEvent): void => {
    this.#pressedKeys.delete(e.key)
  }

  /** A keyup may be missed while focus is elsewhere; forget held keys so the next press works. */
  #onBlur = (): void => {
    this.#pressedKeys.clear()
  }

  /** Page turn by user input, dropped as chattering if it comes within `cooldown` ms of the last one. */
  #inputTurn(action: () => Promise<void>): void {
    const now = performance.now()
    if (now - this.#lastInputTurn < this.#options.cooldown) return
    this.#lastInputTurn = now
    void action.call(this)
  }

  /** Clicks inside the page: follow links, or turn pages when the left/right third is clicked. */
  #onClick = (e: MouseEvent): void => {
    const link = (e.target as Element).closest?.('a[href]')
    if (link) {
      e.preventDefault()
      this.#followLink(link.getAttribute('href')!)
      return
    }
    if (!this.#iframe.contentDocument?.getSelection()?.isCollapsed) return
    const x = e.clientX / this.#iframe.clientWidth
    if (x < 1 / 3) this.#inputTurn(this.goLeft)
    else if (x > 2 / 3) this.#inputTurn(this.goRight)
  }

  /** Clicks on the empty sides of a width-limited page turn pages too. */
  #onSideClick = (e: MouseEvent): void => {
    if (e.target !== this.#container) return
    const { left, right } = this.#iframe.getBoundingClientRect()
    if (e.clientX < left) this.#inputTurn(this.goLeft)
    else if (e.clientX > right) this.#inputTurn(this.goRight)
  }

  #followLink(href: string): void {
    const target = resolvePath(href, this.book!.sections[this.#index].href)
    if (target) {
      void this.goTo(target)
    } else if (
      // Only web and mail links: a javascript: URL would run with the host page's origin.
      /^(https?|mailto):/i.test(href) &&
      this.dispatchEvent(new CustomEvent('link', { detail: { href }, cancelable: true }))
    ) {
      this.#window.open(href, '_blank', 'noopener')
    }
  }
}
