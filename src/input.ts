/**
 * User input: keys, clicks, the mouse wheel and touches are turned into page turns here. Each kind
 * can be turned off by an option of the viewer, for apps that handle it themselves.
 */
import type { ViewerOptions } from './options.ts'

/** What the input needs of the viewer. */
export interface InputHost {
  /** The options of the viewer: the same object for its whole life, changed in place. */
  readonly options: Readonly<ViewerOptions>
  next(): Promise<void>
  prev(): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  /** Whether a page of the book is shown: not while the first page of a book just opened is loading. */
  shown(): boolean
  /** The area of the page(s) on the screen, without the empty sides. */
  pagesRect(): { left: number; right: number }
  /** A link in the document `doc` of the book was clicked. */
  followLink(href: string, doc: Document): void
  dispatchEvent(event: Event): boolean
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
 * Anything that the browser would follow as a link: <a> and <area> even without an href (an
 * animation can give one to an SVG <a>), and other elements with an href (in any namespace).
 * Also <use>, likewise without an href: a click on a link that it draws is a click on the <use>.
 */
const LINKS = 'a, area, use, [*|href]'

type Listen = 'addEventListener' | 'removeEventListener'

export class Input {
  readonly #host: InputHost
  readonly #container: HTMLElement
  /** The element that holds the pages; a click on it is a click on the empty sides. */
  readonly #stage: HTMLElement
  readonly #pressedKeys = new Set<string>()
  #lastTurn = -Infinity
  /** Current wheel gesture: scroll distance so far, whether it has turned a page, and its last event time. */
  #wheel = { x: 0, y: 0, turned: false, last: -Infinity }
  /** Whether text was selected when the pointer was last pressed. */
  #selectedAtPress = false
  /** Where the current one-finger touch began. */
  #touchStart?: { x: number; y: number }

  constructor(container: HTMLElement, stage: HTMLElement, host: InputHost) {
    this.#container = container
    this.#stage = stage
    this.#host = host
    container.addEventListener('click', this.#onSideClick)
    this.#listenGestures(container, 'addEventListener')
    this.#listenKeys(this.#window, 'addEventListener')
  }

  /**
   * Listens in a document of the book as well: what happens over the page stays in its iframe,
   * and does not reach the container or the host window.
   */
  attach(doc: Document): void {
    this.#listenKeys(doc.defaultView!, 'addEventListener')
    // On the root element, not the document: Safari on iOS only turns a tap into a click when an
    // element, rather than the document, listens for clicks.
    doc.documentElement.addEventListener('click', this.#onClick)
    doc.documentElement.addEventListener('auxclick', this.#onAuxClick)
    this.#listenGestures(doc, 'addEventListener')
    doc.addEventListener('pointerdown', this.#onPointerDown)
  }

  destroy(): void {
    this.#container.removeEventListener('click', this.#onSideClick)
    this.#listenGestures(this.#container, 'removeEventListener')
    this.#listenKeys(this.#window, 'removeEventListener')
  }

  get #window(): Window {
    return this.#container.ownerDocument.defaultView!
  }

  #listenGestures(target: HTMLElement | Document, method: Listen): void {
    target[method]('wheel', this.#onWheel as EventListener, { passive: false })
    // Passive: swipes are only watched, so that the browser's own touch gestures keep working.
    target[method]('touchstart', this.#onTouchStart as EventListener, { passive: true })
    target[method]('touchend', this.#onTouchEnd as EventListener)
    target[method]('touchcancel', this.#onTouchEnd as EventListener)
  }

  #listenKeys(target: Window, method: Listen): void {
    target[method]('keydown', this.#onKeydown as EventListener)
    target[method]('keyup', this.#onKeyup as EventListener)
    target[method]('blur', this.#onBlur)
  }

  /** A page turn, dropped as chattering if it comes within `cooldown` ms of the one before. */
  #turn(direction: 'next' | 'prev' | 'goLeft' | 'goRight'): void {
    const now = performance.now()
    if (now - this.#lastTurn < this.#host.options.cooldown) return
    this.#lastTurn = now
    // The user has no caller to reject to.
    this.#host[direction]().catch((error: unknown) => this.#host.dispatchEvent(new CustomEvent('error', { detail: { error } })))
  }

  #onKeydown = (e: KeyboardEvent): void => {
    if (!this.#host.options.keyboard || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
    const target = e.target as Element
    if (target.closest?.('input, textarea, select, [contenteditable]')) return
    if (e.key === ' ' && target.closest?.('button, summary')) return // Space presses the focused button
    const direction = (
      {
        ArrowLeft: 'goLeft',
        ArrowRight: 'goRight',
        ArrowUp: 'prev', // e.g. the up / down buttons of a remote control
        ArrowDown: 'next',
        PageUp: 'prev',
        PageDown: 'next',
        ' ': e.shiftKey ? 'prev' : 'next',
      } as const
    )[e.key]
    if (!direction) return
    e.preventDefault()
    // One press, one page: ignore auto-repeat while the key is held. Tracked here instead of
    // `e.repeat` because some remote controls send repeats without setting it.
    if (this.#pressedKeys.has(e.key)) return
    this.#pressedKeys.add(e.key)
    this.#turn(direction)
  }

  #onKeyup = (e: KeyboardEvent): void => {
    this.#pressedKeys.delete(e.key)
  }

  /** A keyup may be missed while focus is elsewhere; forget held keys so the next press works. */
  #onBlur = (): void => {
    this.#pressedKeys.clear()
  }

  /**
   * Clicks inside the page: a link is followed; otherwise see #clickAt.
   */
  #onClick = (e: MouseEvent): void => {
    // The page of the book before this one, still on the screen while the first page loads.
    if (!this.#host.shown()) return e.preventDefault()
    const doc = (e.target as Element).ownerDocument
    // The default is always prevented: the frame must not go anywhere by itself.
    const link = (e.target as Element).closest?.(LINKS)
    if (link) e.preventDefault()
    // Only <a> and <area> are links to follow. Other elements have an href for what they show
    // (<image> and <use> in SVG: a page is often one <image>), and are clicked like the rest of the page.
    const href = link?.matches('a, area') ? (link.getAttribute('href') ?? link.getAttributeNS('http://www.w3.org/1999/xlink', 'href')) : null
    if (href != null) return this.#host.followLink(href, doc)
    if (this.#selecting(doc)) return
    // The position on the screen: the frame may be scaled, or one of two.
    const frame = doc.defaultView!.frameElement!
    const rect = frame.getBoundingClientRect()
    this.#clickAt(rect.left + (e.clientX * rect.width) / frame.clientWidth)
  }

  /**
   * Clicks with the other mouse buttons: the middle one would open a link in a new tab, without
   * the viewer (and the app, by the link event) having a say in it.
   */
  #onAuxClick = (e: MouseEvent): void => {
    if ((e.target as Element).closest?.(LINKS)) e.preventDefault()
  }

  /** Clicks on the empty room around the page(s) count as clicks on the edge of the page next to them. */
  #onSideClick = (e: MouseEvent): void => {
    if (e.target === this.#stage) this.#clickAt(e.clientX)
  }

  /** A click at `clientX` (in the host window): the left and right thirds of the page(s) turn the page, the rest is a tap. */
  #clickAt(clientX: number): void {
    const { left, right } = this.#host.pagesRect()
    const x = Math.min(Math.max((clientX - left) / (right - left), 0), 1)
    if (!this.#host.options.click || (x >= 1 / 3 && x <= 2 / 3)) this.#host.dispatchEvent(new CustomEvent('tap', { detail: { x } }))
    else this.#turn(x < 1 / 3 ? 'goLeft' : 'goRight')
  }

  /**
   * Text is selected in the document, or was when the pointer was pressed: neither the click or
   * swipe that selects text, nor the one that only clears the selection, must turn the page.
   */
  #selecting(doc: Document): boolean {
    return this.#selectedAtPress || doc.getSelection()?.isCollapsed === false
  }

  /** Before the browser clears the selection for the press. */
  #onPointerDown = (e: Event): void => {
    this.#selectedAtPress = (e.currentTarget as Document).getSelection()?.isCollapsed === false
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
    if (!start || !this.#host.options.swipe || e.type === 'touchcancel') return
    if (this.#selecting((e.target as Node).ownerDocument!)) return
    const dx = e.changedTouches[0].screenX - start.x
    const dy = e.changedTouches[0].screenY - start.y
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < SWIPE_SLOPE * Math.abs(dy)) return
    if ((this.#window.visualViewport?.scale ?? 1) > 1.01) return
    this.#turn(dx > 0 ? 'goLeft' : 'goRight')
  }

  /**
   * One page per wheel gesture. A mouse wheel notch is a single event, but a trackpad swipe sends
   * a stream of small ones followed by momentum, so the gesture is turned once and the rest ignored.
   */
  #onWheel = (e: WheelEvent): void => {
    if (!this.#host.options.wheel || e.ctrlKey) return // Ctrl + wheel (and trackpad pinch) zooms
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
    if (Math.abs(wheel.x) > Math.abs(wheel.y)) this.#turn(wheel.x > 0 ? 'goRight' : 'goLeft')
    else this.#turn(wheel.y > 0 ? 'next' : 'prev')
  }
}
