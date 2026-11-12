import { resolvePath, type Book } from './book.ts'
import { fitScale, pageSize, pairPages, twoPages } from './fixed.ts'
import { Input } from './input.ts'
import { DEFAULT_OPTIONS, type ViewerOptions } from './options.ts'
import { firstText, pageOf, paginate, scrolledPage, scrollToPage, type Pagination } from './reflow.ts'

/** A position in a book that survives re-layout (font size / window size changes). */
export interface BookLocation {
  /** Index into `book.sections`. Negative counts from the end, as in `Array.at()` (-1 = last section). */
  index: number
  /**
   * Position within the section: the share of it that comes before the page. 0 is the first page;
   * the last page of n is (n - 1) / n when read, and 1 is also taken for it when given.
   */
  progress: number
}

/** Where to go: a BookLocation, a TocItem href, or a position in the whole book (the `fraction` of the relocate event, 0 to 1). */
export type BookTarget = BookLocation | string | { fraction: number }

export interface RelocateDetail extends BookLocation {
  /** 0-based page number within the section. */
  page: number
  /** Number of pages in the section. A page of a fixed-layout book is a section of its own, of one page. */
  pages: number
  /** Estimated progress through the whole book, up to the end of the page: 1 on the last page. `goTo({ fraction })` leads back here. */
  fraction: number
  /** Pages progress to the left (vertical text, manga): goLeft() is next(). For the direction of a slider or of buttons. */
  rtl: boolean
  /** The sections on the screen: one, or the two pages of a spread of a fixed-layout book (`index` is the first). */
  indices: number[]
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
  /**
   * A click or tap on the page that neither follows a link nor turns the page: on the middle of the
   * page, or anywhere with the `click` option off. `x` is the position across the page(s), from
   * 0 (left edge) to 1. For showing and hiding controls, or page turns of your own.
   */
  tap: CustomEvent<{ x: number }>
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

/** A frame, or its slot, that fills the room it is given. */
const FILL = 'width:100%;height:100%'
/** The pagination of a fixed-layout page: it is a page as it is. */
const ONE_PAGE: Pagination = { writingMode: '', vertical: false, pageSize: 0, pages: 1 }

/**
 * Shows a book page by page, in iframes (scripts disabled). The text of a reflowable book is
 * split into pages (see reflow.ts); the pages of a fixed-layout book are shown as they are, scaled
 * to fit, one or two at a time (see fixed.ts). User input is handled in input.ts.
 *
 * This class keeps what is shown: the frames, the position, and the navigations between them.
 */
export class EpubViewer extends EventTarget {
  #book?: Book
  readonly #container: HTMLElement
  /** Holds the frame(s), centered. */
  readonly #stage: HTMLElement
  /** The frame of the section shown; in a fixed-layout book, one for each page of the spread. */
  #frames: HTMLIFrameElement[]
  /** The sections in the frames. */
  #shown: number[] = []
  readonly #options: ViewerOptions = { ...DEFAULT_OPTIONS }
  readonly #input: Input
  readonly #resizeObserver = new ResizeObserver(() => this.#relayout())

  // Reflowable text: the rules that split the document shown into pages are written into #style.
  #style?: HTMLStyleElement
  /** The writing mode that the book declares for the section. */
  #bookWritingMode = 'horizontal-tb'
  #pagination = ONE_PAGE
  /** The first section shown, or -1 while there is none (a book has just been opened and is loading). */
  #index = -1
  #page = 0
  /** The text that the page began with before the re-layouts since the last navigation. */
  #anchor?: Range

  // Navigations (see #display) overlap, as they wait for files to load.
  /** The number of the navigation started last. */
  #navigation = 0
  /** The number of the navigation that changed the page last, or is doing so: those started before it give up. */
  #committed = 0
  /** The latest navigation is under way: page turns by the user are ignored meanwhile. */
  #busy = false

  /** `container` must have a size (e.g. width/height set by CSS); the viewer fills it. */
  constructor(container: HTMLElement, options: Partial<ViewerOptions> = {}) {
    super()
    this.#container = container
    this.#stage = container.ownerDocument.createElement('div')
    this.#stage.style.cssText = `position:relative;display:flex;justify-content:center;align-items:center;${FILL}`
    this.#frames = [this.#createFrame()]
    this.#styleFrame(this.#frame, FILL, FILL)
    container.style.touchAction = 'manipulation' // as for the page: see reflow.ts
    container.append(this.#stage)
    this.#input = new Input(container, this.#stage, {
      options: this.#options,
      next: () => this.next(),
      prev: () => this.prev(),
      goLeft: () => this.goLeft(),
      goRight: () => this.goRight(),
      shown: () => this.#index >= 0,
      pagesRect: () => this.#pagesRect(),
      followLink: (href, doc) => this.#followLink(href, doc),
      dispatchEvent: (event) => this.dispatchEvent(event),
    })
    this.setOptions(options)
    this.#resizeObserver.observe(container)
  }

  /** The book being shown. */
  get book(): Book | undefined {
    return this.#book
  }

  get options(): Readonly<ViewerOptions> {
    return this.#options
  }

  /** Current position, to be saved and passed to `open()` / `goTo()` later. */
  get location(): BookLocation | undefined {
    return this.#index < 0 ? undefined : { index: this.#index, progress: this.#page / this.#pagination.pages }
  }

  /** Shows `book` at `target`, or at the beginning. The Book shown before is not destroyed. */
  async open(book: Book, target?: BookTarget): Promise<void> {
    this.#book = book
    this.#index = -1
    this.#shown = []
    this.#committed = ++this.#navigation // navigations of the book before give up
    const start = { index: Math.max(0, book.sections.findIndex((s) => s.linear)), progress: 0 }
    await this.goTo(target ?? start)
    // A target that is not in this book, e.g. one saved for an older edition: don't leave the page
    // empty. (Unless another book has been opened meanwhile: that one is not ours to move.)
    if (this.#book === book && this.#index < 0) await this.goTo(start)
  }

  /** Moves to `target`. Does nothing if that is not in the book. */
  async goTo(target: BookTarget): Promise<void> {
    if (typeof target === 'string') {
      const [path, fragment] = target.split('#')
      const index = this.#book?.sections.findIndex((s) => s.href === path) ?? -1
      if (index >= 0) await this.#display(index, { fragment })
    } else if ('fraction' in target) {
      await this.#seek(target.fraction)
    } else {
      const index = target.index < 0 ? (this.#book?.sections.length ?? 0) + target.index : target.index
      await this.#display(index, { progress: target.progress })
    }
  }

  next(): Promise<void> {
    return this.#turn(1)
  }

  prev(): Promise<void> {
    return this.#turn(-1)
  }

  /** Page turn towards the left: the next page for a book read from right to left (vertical text, manga), the previous one otherwise. */
  goLeft(): Promise<void> {
    return this.#turn(this.#rtl ? 1 : -1)
  }

  goRight(): Promise<void> {
    return this.#turn(this.#rtl ? -1 : 1)
  }

  setOptions(options: Partial<ViewerOptions>): void {
    Object.assign(this.#options, options)
    this.#container.style.background = this.#options.theme.background
    this.#relayout()
  }

  destroy(): void {
    // Stops navigations under way, and makes later calls (setOptions, next, ...) do nothing.
    this.#committed = ++this.#navigation
    this.#book = undefined
    this.#index = -1
    this.#resizeObserver.disconnect()
    this.#input.destroy()
    this.#stage.remove()
  }

  // ---- What kind of book, and which way it goes

  /** The book is a fixed-layout one: every section is a page. */
  get #fixed(): boolean {
    return this.#book?.metadata.layout === 'pre-paginated'
  }

  /** Pages progress to the left. */
  get #rtl(): boolean {
    const { direction } = this.#options
    return this.#fixed
      ? (direction === 'auto' ? this.#book!.metadata.direction : direction) === 'rtl'
      : this.#pagination.writingMode === 'vertical-rl'
  }

  /** Fixed layout: the pages (as indices of sections) shown together, in reading order. */
  #spreads(): number[][] {
    const { width, height } = this.#stage.getBoundingClientRect()
    return pairPages(this.#book!.sections, this.#rtl ? 'rtl' : 'ltr', twoPages(width, height, this.#options.spread))
  }

  /** The sections shown together with the one at `index`: in a fixed-layout book, the pages of its spread. */
  #shownWith(index: number): number[] {
    return (this.#fixed && this.#spreads().find((spread) => spread.includes(index))) || [index]
  }

  /** The section that a page turn past what is shown leads to, if there is one. */
  #neighbor(step: 1 | -1): number | undefined {
    const { sections } = this.#book!
    if (this.#fixed) {
      const spreads = this.#spreads()
      const [from, to] = [this.#index, this.#shown[this.#shown.length - 1]]
      return (step > 0 ? spreads.find((s) => s[0] > to) : spreads.findLast((s) => s[s.length - 1] < from))?.[0]
    }
    let index = this.#index + step
    while (sections[index] && !sections[index].linear) index += step
    return sections[index] ? index : undefined
  }

  // ---- Frames

  /** The frame of the section; in a fixed-layout book, of the first page. */
  get #frame(): HTMLIFrameElement {
    return this.#frames[0]
  }

  /**
   * A frame in its slot: the slot takes the room in the layout, so that the frame can be scaled
   * inside it. Out of sight until it is styled: a document is loaded there while the page before
   * it stays on the screen.
   */
  #createFrame(): HTMLIFrameElement {
    const iframe = this.#container.ownerDocument.createElement('iframe')
    iframe.title = this.#book?.metadata.title ?? '' // names the frame for screen readers
    // allow-same-origin: the viewer styles the document and listens to its events.
    // allow-scripts: WebKit does not fire our event listeners without it. The book's own
    // scripts are still blocked by the CSP that Book inserts into every document.
    iframe.sandbox.add('allow-same-origin', 'allow-scripts')
    const slot = this.#container.ownerDocument.createElement('div')
    slot.append(iframe)
    this.#stage.append(slot)
    this.#styleFrame(iframe, 'position:absolute;inset:0;visibility:hidden', FILL)
    return iframe
  }

  #styleFrame(iframe: HTMLIFrameElement, slot: string, frame: string): void {
    iframe.parentElement!.style.cssText = `flex:none;overflow:hidden;${slot}`
    iframe.style.cssText = `display:block;border:0;${frame}`
  }

  #loadFrame(iframe: HTMLIFrameElement, url: string): Promise<Document> {
    return new Promise((resolve) => {
      let loaded = false
      iframe.addEventListener('load', async () => {
        const doc = iframe.contentDocument
        if (loaded) {
          // A frame is loaded once. If it loads again, the book has taken it to another page by a
          // way that is not known (the known ones are closed in book.ts and input.ts): that page is not shown.
          if (doc?.URL === 'about:blank') return
          iframe.src = 'about:blank'
          this.dispatchEvent(new CustomEvent('error', { detail: { error: new Error('The book tried to leave its page') } }))
        } else if (doc && doc.URL !== 'about:blank') {
          loaded = true
          await doc.fonts.ready
          resolve(doc)
        }
      })
      iframe.src = url
    })
  }

  /** The area of the page(s), without the empty sides. */
  #pagesRect(): { left: number; right: number } {
    const rects = this.#frames.map((frame) => frame.parentElement!.getBoundingClientRect())
    return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) }
  }

  // ---- Navigation

  async #turn(step: 1 | -1): Promise<void> {
    if (!this.#book || this.#busy || this.#index < 0) return
    const page = this.#page + step
    if (page >= 0 && page < this.#pagination.pages) return this.#showPage(page)
    const index = this.#neighbor(step)
    if (index !== undefined) return this.#display(index, { progress: step > 0 ? 0 : 1 })
    this.dispatchEvent(new Event(step > 0 ? 'bookend' : 'bookstart'))
  }

  /** Shows the page that `fraction` of the whole book falls on: the reverse of the fraction of the relocate event. */
  async #seek(fraction: number): Promise<void> {
    const sizes = (this.#book?.sections ?? []).map((section) => section.size)
    const part = Math.min(Math.max(fraction, 0), 1)
    // A page ends at (page + 1) / pages; the small amounts make up for rounding errors, which
    // would lead to the page after the one that reported the fraction.
    if (this.#fixed) return this.#display(Math.max(0, Math.ceil(part * sizes.length - 1e-6) - 1), {})
    // The section that this much of the book (in bytes) ends in, and how far into it.
    const total = sizes.reduce((a, b) => a + b, 0)
    let rest = part * total
    let index = 0
    while (index < sizes.length - 1 && rest > sizes[index] + total * 1e-9) rest -= sizes[index++]
    await this.#display(index, { reach: sizes[index] ? rest / sizes[index] : 0 })
  }

  /**
   * Shows a section. The page of it: the one with the element `fragment`, or the one that `reach`
   * (0 to 1) of the section falls on, or the one that starts at `progress` (0 to 1).
   */
  async #display(index: number, { progress = 0, reach, fragment }: { progress?: number; reach?: number; fragment?: string }): Promise<void> {
    const book = this.#book
    if (!book?.sections[index]) return
    const navigation = ++this.#navigation
    this.#busy = true
    try {
      // First, while nothing has changed yet: if this throws, the current page, or another
      // navigation that is under way, stays as it is.
      const indices = this.#shownWith(index)
      const shown = indices.join() === this.#shown.join()
      const urls = shown ? [] : await Promise.all(indices.map((i) => book.getUrl(book.sections[i].href))).catch((error) => error as Error)
      // A navigation started after this one has changed the page already (or another book was
      // opened, or the viewer destroyed): the one asked for last wins, not the one ready last.
      if (navigation < this.#committed) return
      if (urls instanceof Error) throw urls
      this.#committed = navigation
      if (!shown) {
        // Loaded in frames of their own, out of sight, and put in the place of the page shown only
        // when ready: the screen does not go blank in between (in manga, at every page turn).
        const frames = urls.map(() => this.#createFrame())
        const docs = await Promise.all(frames.map((frame, i) => this.#loadFrame(frame, urls[i])))
        const superseded = this.#committed !== navigation // by a newer navigation
        for (const frame of superseded ? frames : this.#frames) frame.parentElement!.remove()
        if (superseded) return
        this.#frames = frames
        this.#index = indices[0]
        this.#shown = indices
        docs.forEach((doc, i) => this.#setup(doc, indices[i]))
      }
      this.#layout()
      const target = !this.#fixed && fragment ? this.#frame.contentDocument!.getElementById(fragment) : null
      const { pages } = this.#pagination
      // A page ends at (page + 1) / pages of the section; the small amount is for rounding errors.
      const page = reach === undefined ? Math.round(progress * pages) : Math.ceil(reach * pages - 1e-6) - 1
      this.#showPage(target ? pageOf(this.#frame.contentDocument!, this.#pagination, target) : page)
      // What the next page turn leads to is made ready ahead of time (its files are unpacked).
      const next = this.#neighbor(1)
      for (const i of next === undefined ? [] : this.#shownWith(next)) book.getUrl(book.sections[i].href).catch(() => {})
    } finally {
      // Only the latest one: a navigation that never finishes (a file that cannot be read to its
      // end) must not block page turns for good, once a later navigation has shown a page.
      if (navigation === this.#navigation) this.#busy = false
    }
  }

  /** Prepares a document that has been loaded into a frame. */
  #setup(doc: Document, index: number): void {
    const style = doc.createElement('style')
    ;(doc.head ?? doc.documentElement).append(style)
    if (this.#fixed) {
      // A fixed-layout page is shown as it is. Only what a page larger than its declared size, and
      // double taps, would do is stopped (see reflow.ts for touch-action).
      style.textContent = 'html { overflow: hidden !important; touch-action: manipulation !important; }'
    } else {
      this.#style = style
      this.#bookWritingMode = doc.defaultView!.getComputedStyle(doc.body ?? doc.documentElement).writingMode
      doc.addEventListener('scroll', this.#onScroll)
    }
    this.#input.attach(doc)
    this.dispatchEvent(new CustomEvent('sectionload', { detail: { index, doc } }))
  }

  #followLink(href: string, doc: Document): void {
    // Relative to the section that the link is in: of a spread, that may be the second page.
    const from = this.#shown[this.#frames.findIndex((frame) => frame.contentDocument === doc)] ?? this.#index
    const target = resolvePath(href, this.#book!.sections[from].href)
    if (target) {
      this.goTo(target).catch((error: unknown) => this.dispatchEvent(new CustomEvent('error', { detail: { error } })))
    } else if (
      // Only web and mail links: a javascript: URL would run with the host page's origin.
      /^(https?|mailto):/i.test(href) &&
      this.dispatchEvent(new CustomEvent('link', { detail: { href }, cancelable: true }))
    ) {
      this.#container.ownerDocument.defaultView!.open(href, '_blank', 'noopener')
    }
  }

  // ---- Layout and pages

  /** Fits what is shown to the container and the options. */
  #layout(): void {
    if (this.#fixed) {
      // A frame keeps the size of its page, which is what the page is laid out for, and is scaled as a whole.
      const sizes = this.#frames.map((frame) => pageSize(frame.contentDocument!))
      const { width, height } = this.#stage.getBoundingClientRect()
      const scale = fitScale(sizes, width, height)
      this.#frames.forEach((frame, i) => {
        const [w, h] = sizes[i]
        this.#styleFrame(frame, `width:${w * scale}px;height:${h * scale}px`, `width:${w}px;height:${h}px;transform:scale(${scale});transform-origin:0 0`)
      })
      this.#stage.style.flexDirection = this.#rtl ? 'row-reverse' : 'row' // the first page on the right for "rtl"
      this.#pagination = ONE_PAGE
      return
    }
    const doc = this.#frame.contentDocument
    if (!doc || !this.#style) return
    const { maxWidth } = this.#options
    this.#styleFrame(this.#frame, `${FILL};max-width:${maxWidth > 0 ? `${maxWidth}px` : 'none'}`, FILL)
    this.#stage.style.flexDirection = ''
    const { width, height } = this.#frame.getBoundingClientRect()
    this.#pagination = paginate(doc, this.#style, width, height, this.#bookWritingMode, this.#options)
  }

  /** The container or the options have changed. */
  #relayout(): void {
    const { width, height } = this.#stage.getBoundingClientRect()
    // Nothing is shown yet. Or the container is hidden (it has no size): there is nothing to lay
    // out, and the position must not be lost; this is called again when it is shown.
    if (this.#index < 0 || !width || !height) return
    if (this.#fixed) {
      if (this.#shownWith(this.#index).join() === this.#shown.join()) {
        this.#layout() // scaled anew
        this.#setPage(0)
      } else {
        // The room for a spread has changed: the same page again, with or without its neighbor.
        this.#display(this.#index, {}).catch((error: unknown) => this.dispatchEvent(new CustomEvent('error', { detail: { error } })))
      }
      return
    }
    // The text at the start of the page is found again after the layout: the same share of the
    // section would be a different place. Kept through a series of re-layouts (font size up, up,
    // down, ...), so that they don't drift.
    const doc = this.#frame.contentDocument!
    // Back to the page first: while the container was hidden, the browser may have scrolled the document to its start.
    scrollToPage(doc, this.#pagination, this.#page)
    const anchor = this.#anchor ?? firstText(doc, this.#pagination)
    const progress = this.#page / this.#pagination.pages
    this.#layout()
    this.#showPage(anchor ? pageOf(doc, this.#pagination, anchor) : Math.round(progress * this.#pagination.pages))
    this.#anchor = anchor
  }

  #showPage(page: number): void {
    const shown = Math.min(Math.max(page, 0), this.#pagination.pages - 1)
    if (!this.#fixed) scrollToPage(this.#frame.contentDocument!, this.#pagination, shown)
    this.#setPage(shown)
  }

  /**
   * The browser scrolls the page by itself for find in page, for the focus moving to a link, and
   * for a selection dragged over the edge. Its position is left alone, as what it shows must stay
   * visible; the page number follows, so that the next page turn continues from there.
   */
  #onScroll = (e: Event): void => {
    const doc = e.currentTarget as Document
    // Not while the container is hidden: the browser then scrolls the document to its start, which is not a move.
    if (this.#index < 0 || doc !== this.#frame.contentDocument || !this.#stage.offsetWidth) return
    const page = scrolledPage(doc, this.#pagination)
    if (page !== this.#page && page < this.#pagination.pages) this.#setPage(page)
  }

  #setPage(page: number): void {
    this.#anchor = undefined
    this.#page = page
    const sizes = this.#book!.sections.map((s) => s.size)
    const { pages } = this.#pagination
    // In a fixed-layout book every section counts as one page; otherwise by the size of the sections.
    const total = sizes.reduce((a, b) => a + b, 0) || 1
    const before = sizes.slice(0, this.#index).reduce((a, b) => a + b, 0)
    const fraction = this.#fixed
      ? (this.#shown[this.#shown.length - 1] + 1) / sizes.length
      : (before + (sizes[this.#index] * (page + 1)) / pages) / total
    const detail: RelocateDetail = { ...this.location!, page, pages, fraction, rtl: this.#rtl, indices: [...this.#shown] }
    this.dispatchEvent(new CustomEvent('relocate', { detail }))
  }
}
