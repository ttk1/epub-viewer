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
  /** Turn pages with ←/→, ↑/↓, PageUp/PageDown and Space pressed anywhere in the host window. */
  keyboard: boolean
  /** Turn pages with clicks / taps on the left and right thirds of the page. Links in the book work either way. */
  click: boolean
  /** Turn pages with the mouse wheel / trackpad over the viewer: one page per wheel gesture. */
  wheel: boolean
  /** Turn pages with sideways swipes on touch screens. */
  swipe: boolean
  /**
   * Page-turn keys, clicks, wheel gestures and swipes within this many ms of the previous accepted one are ignored, so that
   * chattering (e.g. remote controls) does not skip pages. Keep it short so fast deliberate presses still work.
   */
  cooldown: number
}

/** A position that survives re-layout (font size / window size changes). */
export interface Location {
  /** Index into `book.sections`. Negative counts from the end, as in `Array.at()` (-1 = last section). */
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
  /** A page turn by key, click, wheel or swipe, or a link in the book, failed (e.g. a broken section). Calls from code reject instead. */
  error: CustomEvent<{ error: unknown }>
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
  click: true,
  wheel: true,
  swipe: true,
  cooldown: 100,
}

/** A wheel gesture ends when no wheel event comes for this many ms (trackpad momentum keeps sending them). */
const WHEEL_GESTURE_GAP = 150
/** Scroll distance in px within one gesture that turns a page, so that a resting finger on a trackpad does not. */
const WHEEL_THRESHOLD = 10
/** Finger travel in px that makes a touch a swipe rather than a tap. */
const SWIPE_DISTANCE = 40
/** A swipe travels at least this many times further sideways than vertically; steeper touches are scrolling. */
const SWIPE_SLOPE = 1.5

/**
 * Paginated EPUB renderer. Each section is shown in an iframe (scripts disabled) and split into
 * pages with CSS multi-column layout. For vertical text the columns stack downwards, so a page
 * turn is a vertical scroll; for horizontal text it is a horizontal scroll.
 */
export class EpubViewer extends EventTarget {
  #book?: Book
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
  // Navigations (see #display) overlap, as they wait for files to load.
  /** Incremented when a navigation begins to change the page: an older one that is still loading gives up. */
  #token = 0
  /** Incremented when a navigation starts, to tell whether it is the latest one when it ends. */
  #navigation = 0
  /** The latest navigation is under way: page turns by the user are ignored meanwhile. */
  #busy = false
  readonly #pressedKeys = new Set<string>()
  #lastInputTurn = -Infinity
  /** Current wheel gesture: scroll distance so far, whether it has turned a page, and its last event time. */
  #wheel = { x: 0, y: 0, turned: false, last: -Infinity }
  /** The text that the page began with before the re-layouts since the last navigation. */
  #anchor?: Range
  /** Whether text was selected when the pointer was last pressed. */
  #selectedAtPress = false
  /** Where the current one-finger touch began. */
  #touchStart?: { x: number; y: number }

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
    container.style.touchAction = 'manipulation' // as for the page: see #layout
    container.append(this.#iframe)
    container.addEventListener('click', this.#onSideClick)
    this.#listenGestures(container, 'addEventListener')
    this.setOptions(options)
    this.#resizeObserver.observe(container)
    this.#listenKeys(this.#window, 'addEventListener')
  }

  /** The book being shown. */
  get book(): Book | undefined {
    return this.#book
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
    this.#book = book
    this.#index = -1
    this.#iframe.title = book.metadata.title // names the frame for screen readers
    const start = { index: Math.max(0, book.sections.findIndex((s) => s.linear)), progress: 0 }
    await this.goTo(location ?? start)
    // A location that is not in this book, e.g. one saved for an older edition: don't leave the page empty.
    if (this.#index < 0) await this.goTo(start)
  }

  async goTo(target: Location | string): Promise<void> {
    if (typeof target !== 'string') {
      const index = target.index < 0 ? (this.#book?.sections.length ?? 0) + target.index : target.index
      return this.#display(index, { progress: target.progress })
    }
    const [path, fragment] = target.split('#')
    const index = this.#book?.sections.findIndex((s) => s.href === path) ?? -1
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
    // Stops navigations under way, and makes later calls (setOptions, next, ...) do nothing.
    this.#token++
    this.#book = undefined
    this.#index = -1
    this.#resizeObserver.disconnect()
    this.#listenKeys(this.#window, 'removeEventListener')
    this.#container.removeEventListener('click', this.#onSideClick)
    this.#listenGestures(this.#container, 'removeEventListener')
    this.#iframe.remove()
  }

  /**
   * Wheel and touch handling for the container (the empty sides of a width-limited page) or a
   * section document: events over the page stay in the iframe; they don't reach the container.
   */
  #listenGestures(target: HTMLElement | Document, method: 'addEventListener' | 'removeEventListener'): void {
    target[method]('wheel', this.#onWheel as EventListener, { passive: false })
    // Passive: swipes are only watched, so that the browser's own touch gestures keep working.
    target[method]('touchstart', this.#onTouchStart as EventListener, { passive: true })
    target[method]('touchend', this.#onTouchEnd as EventListener)
    target[method]('touchcancel', this.#onTouchEnd as EventListener)
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
    const sections = this.#book?.sections
    if (!sections || this.#busy || this.#index < 0) return
    const page = this.#page + step
    if (page >= 0 && page < this.#pages) return this.#showPage(page)
    let index = this.#index + step
    while (sections[index] && !sections[index].linear) index += step
    if (sections[index]) return this.#display(index, { progress: step > 0 ? 0 : 1 })
    this.dispatchEvent(new Event(step > 0 ? 'bookend' : 'bookstart'))
  }

  async #display(index: number, { progress = 0, fragment }: { progress?: number; fragment?: string }): Promise<void> {
    const book = this.#book
    const section = book?.sections[index]
    if (!section) return
    const navigation = ++this.#navigation
    this.#busy = true
    try {
      // First, while nothing has changed yet: if this throws, the current page, or another
      // navigation that is under way, stays as it is.
      const url = index === this.#index ? undefined : await book!.getUrl(section.href)
      if (book !== this.#book) return // another book was opened, or the viewer destroyed, meanwhile
      const token = ++this.#token
      if (url) {
        this.#index = -1
        const doc = await this.#load(url)
        if (token !== this.#token) return // superseded by a newer navigation
        this.#index = index
        this.#setup(doc)
      }
      this.#layout()
      const target = fragment && this.#iframe.contentDocument!.getElementById(fragment)
      this.#showPage(target ? this.#pageOf(target) : Math.round(progress * this.#pages))
      this.#iframe.style.visibility = ''
    } finally {
      // Only the latest one: a navigation that never finishes (a file that cannot be read to its
      // end) must not block page turns for good, once a later navigation has shown a page.
      if (navigation === this.#navigation) this.#busy = false
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
    // On the root element, not the document: Safari on iOS only turns a tap into a click when an
    // element, rather than the document, listens for clicks.
    doc.documentElement.addEventListener('click', this.#onClick)
    this.#listenGestures(doc, 'addEventListener')
    doc.addEventListener('scroll', this.#onScroll)
    doc.addEventListener('pointerdown', this.#onPointerDown)
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
      /* Defaults only; the book's own CSS wins. A line longer than a page would run into the
         next page, so break runs without break opportunities (e.g. "……" × 100) where they
         overflow, and wrap preformatted text. */
      html { line-height: 1.6; overflow-wrap: break-word; }
      pre { white-space: pre-wrap; }
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
        /* Quick taps on the side of the page turn pages; they must not zoom in as double taps.
           Panning and pinch zoom stay as they are. */
        touch-action: manipulation !important;
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
    if (this.#index < 0) return // nothing is shown, or a section is loading
    // Kept through a series of re-layouts (font size up, up, down, ...), so that they don't drift.
    const anchor = this.#anchor ?? this.#firstText()
    const progress = this.#page / this.#pages
    this.#layout()
    this.#showPage(anchor ? this.#pageOf(anchor) : Math.round(progress * this.#pages))
    this.#anchor = anchor
  }

  /** The first character of the current page: what the reader is at, to be found again after a re-layout. */
  #firstText(): Range | undefined {
    const doc = this.#iframe.contentDocument!
    const range = doc.createRange()
    // Pages follow each other along the scroll axis, so text on earlier pages ends before 0.
    // Text that is not rendered (e.g. collapsed white space) has an empty box.
    const reaches = (node: Text, end: number): boolean => {
      range.setStart(node, 0)
      range.setEnd(node, end)
      const rect = range.getBoundingClientRect()
      return (rect.width > 0 || rect.height > 0) && (this.#vertical ? rect.bottom : rect.right) > 0
    }
    const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT)
    for (let node; (node = walker.nextNode() as Text | null); ) {
      if (!reaches(node, node.length)) continue
      // Binary search for the first character that reaches the page (a paragraph may begin on an earlier page).
      let [low, high] = [0, node.length - 1]
      while (low < high) {
        const middle = (low + high) >> 1
        if (reaches(node, middle + 1)) high = middle
        else low = middle + 1
      }
      range.setStart(node, low)
      range.setEnd(node, low + 1)
      // Text that begins on a later page: the current one has none (e.g. a page with only an image).
      const rect = range.getBoundingClientRect()
      return (this.#vertical ? rect.top : rect.left) < this.#pageSize ? range : undefined
    }
    return undefined
  }

  #showPage(page: number): void {
    const doc = this.#iframe.contentDocument!
    const offset = Math.min(Math.max(page, 0), this.#pages - 1) * this.#pageSize
    doc.scrollingElement!.scrollTo(this.#vertical ? 0 : offset, this.#vertical ? offset : 0)
    this.#setPage(offset / this.#pageSize)
  }

  /**
   * The browser scrolls the page by itself for find in page, for the focus moving to a link, and
   * for a selection dragged over the edge. Its position is left alone, as what it shows must stay
   * visible; the page number follows, so that the next page turn continues from there.
   */
  #onScroll = (): void => {
    if (this.#index < 0) return
    const scroller = this.#iframe.contentDocument!.scrollingElement!
    const page = Math.round((this.#vertical ? scroller.scrollTop : scroller.scrollLeft) / this.#pageSize)
    if (page !== this.#page && page < this.#pages) this.#setPage(page)
  }

  #setPage(page: number): void {
    this.#anchor = undefined
    this.#page = page
    const sizes = this.#book!.sections.map((s) => s.size)
    const total = sizes.reduce((a, b) => a + b, 0) || 1
    const before = sizes.slice(0, this.#index).reduce((a, b) => a + b, 0)
    const detail: RelocateDetail = {
      ...this.location!,
      page,
      pages: this.#pages,
      fraction: (before + (sizes[this.#index] * (page + 1)) / this.#pages) / total,
    }
    this.dispatchEvent(new CustomEvent('relocate', { detail }))
  }

  #pageOf(target: Element | Range): number {
    const rect = target.getBoundingClientRect()
    const scroller = this.#iframe.contentDocument!.scrollingElement!
    const offset = this.#vertical ? rect.top + scroller.scrollTop : rect.left + scroller.scrollLeft
    return Math.floor(offset / this.#pageSize)
  }

  #onKeydown = (e: KeyboardEvent): void => {
    if (!this.#options.keyboard || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
    const target = e.target as Element
    if (target.closest?.('input, textarea, select, [contenteditable]')) return
    if (e.key === ' ' && target.closest?.('button, summary')) return // Space presses the focused button
    const actions: Record<string, () => Promise<void>> = {
      ArrowLeft: this.goLeft,
      ArrowRight: this.goRight,
      ArrowUp: this.prev, // e.g. the up / down buttons of a remote control
      ArrowDown: this.next,
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
    action.call(this).catch(this.#reportError)
  }

  /** Navigation started by the user has no caller to reject to. */
  #reportError = (error: unknown): void => {
    this.dispatchEvent(new CustomEvent('error', { detail: { error } }))
  }

  /** Clicks inside the page: follow links, or turn pages when the left/right third is clicked. */
  #onClick = (e: MouseEvent): void => {
    // Every kind of link (also <area>, and <a xlink:href> in SVG), so that none navigates the iframe itself.
    const link = (e.target as Element).closest?.('a, area')
    const href = link?.getAttribute('href') ?? link?.getAttribute('xlink:href')
    if (href != null) {
      e.preventDefault()
      this.#followLink(href)
      return
    }
    if (!this.#options.click || this.#selecting) return
    const x = e.clientX / this.#iframe.clientWidth
    if (x < 1 / 3) this.#inputTurn(this.goLeft)
    else if (x > 2 / 3) this.#inputTurn(this.goRight)
  }

  /**
   * Text is selected in the page, or was when the pointer was pressed: neither the click or swipe
   * that selects text, nor the one that only clears the selection, must turn the page.
   */
  get #selecting(): boolean {
    return this.#selectedAtPress || this.#hasSelection
  }

  get #hasSelection(): boolean {
    return this.#iframe.contentDocument?.getSelection()?.isCollapsed === false
  }

  /** Before the browser clears the selection for the press. */
  #onPointerDown = (): void => {
    this.#selectedAtPress = this.#hasSelection
  }

  #onTouchStart = (e: TouchEvent): void => {
    // A swipe is made with one finger; a second one makes it a pinch.
    const [touch, second] = e.touches
    // Screen coordinates: the page moves under the finger while the host page scrolls, so in the
    // coordinates of the page a finger that scrolls hardly seems to move.
    this.#touchStart = second ? undefined : { x: touch.screenX, y: touch.screenY }
  }

  /**
   * Swipes turn the page the way the finger drags it: to the right for the page on the left.
   * Judged when the finger is lifted, without interfering with the touch itself, so that scrolling
   * the host page, pinch zoom and panning a zoomed page work as usual. A touch only counts when it
   * cannot be one of those, or a tap: long enough, clearly sideways, and not zoomed in.
   */
  #onTouchEnd = (e: TouchEvent): void => {
    const start = this.#touchStart
    this.#touchStart = undefined
    if (!start || !this.#options.swipe || e.type === 'touchcancel' || this.#selecting) return
    const dx = e.changedTouches[0].screenX - start.x
    const dy = e.changedTouches[0].screenY - start.y
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < SWIPE_SLOPE * Math.abs(dy)) return
    if ((this.#window.visualViewport?.scale ?? 1) > 1.01) return
    this.#inputTurn(dx > 0 ? this.goLeft : this.goRight)
  }

  /** Clicks on the empty sides of a width-limited page turn pages too. */
  #onSideClick = (e: MouseEvent): void => {
    if (!this.#options.click || e.target !== this.#container) return
    const { left, right } = this.#iframe.getBoundingClientRect()
    if (e.clientX < left) this.#inputTurn(this.goLeft)
    else if (e.clientX > right) this.#inputTurn(this.goRight)
  }

  /**
   * One page per wheel gesture. A mouse wheel notch is a single event, but a trackpad swipe sends
   * a stream of small ones followed by momentum, so the gesture is turned once and the rest ignored.
   */
  #onWheel = (e: WheelEvent): void => {
    if (!this.#options.wheel || e.ctrlKey) return // Ctrl + wheel (and trackpad pinch) zooms
    e.preventDefault() // keep the host page from scrolling
    const wheel = this.#wheel
    const now = performance.now()
    if (now - wheel.last > WHEEL_GESTURE_GAP) Object.assign(wheel, { x: 0, y: 0, turned: false })
    wheel.last = now
    if (wheel.turned) return
    const unit = e.deltaMode === 0 ? 1 : 100 // DOM_DELTA_PIXEL, or lines / pages (Firefox mouse wheel)
    wheel.x += e.deltaX * unit
    wheel.y += e.deltaY * unit
    if (Math.max(Math.abs(wheel.x), Math.abs(wheel.y)) < WHEEL_THRESHOLD) return
    wheel.turned = true
    // Scrolling down goes forward; scrolling sideways moves the page that way, like the arrow keys.
    if (Math.abs(wheel.x) > Math.abs(wheel.y)) this.#inputTurn(wheel.x > 0 ? this.goRight : this.goLeft)
    else this.#inputTurn(wheel.y > 0 ? this.next : this.prev)
  }

  #followLink(href: string): void {
    const target = resolvePath(href, this.#book!.sections[this.#index].href)
    if (target) {
      this.goTo(target).catch(this.#reportError)
    } else if (
      // Only web and mail links: a javascript: URL would run with the host page's origin.
      /^(https?|mailto):/i.test(href) &&
      this.dispatchEvent(new CustomEvent('link', { detail: { href }, cancelable: true }))
    ) {
      this.#window.open(href, '_blank', 'noopener')
    }
  }
}
