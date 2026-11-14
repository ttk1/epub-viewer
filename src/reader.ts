import { openBook, type Book, type BookSource, type TocItem } from './book.ts'
import { fonts, themes, type Theme, type ViewerOptions } from './options.ts'
import { EpubViewer, type BookLocation, type BookTarget } from './viewer.ts'

/** Settings the user changes from the toolbar. Saved (see ReaderOptions.storage) and shared by all books. */
export interface ReaderSettings {
  /** "system" follows the OS dark mode setting. */
  theme: 'system' | 'light' | 'sepia' | 'dark'
  /** "book" keeps the book's own fonts. */
  font: 'mincho' | 'gothic' | 'book'
  fontSize: number
  /** Line height as a multiple of the font size; 0 keeps the book's own. */
  lineHeight: number
  /** Page width in px, 0 = full width. */
  maxWidth: number
  /** Page margin in px. */
  margin: number
  writingMode: ViewerOptions['writingMode']
  /** Two pages (fixed layout) or two columns (horizontal text) side by side. */
  spread: ViewerOptions['spread']
  /** Fixed layout: the side that pages progress towards. */
  direction: ViewerOptions['direction']
}

export interface ReaderOptions {
  /**
   * Where settings and reading positions are saved: anything with getItem / setItem like
   * localStorage, which is the default. Give an object of your own to keep them elsewhere (e.g. to
   * send them to a server as well), or null to save nothing.
   */
  storage: Pick<Storage, 'getItem' | 'setItem'> | null
  /** Prefix of the keys in the storage: "<storageKey>:settings" and "<storageKey>:position:<key of the book>". */
  storageKey: string
  /** Initial settings, used until the user changes them. */
  settings: Partial<ReaderSettings>
  /**
   * The values that the settings menu offers for line height, width and margin, each as
   * `[value, label]`: for a site whose pages want other steps than those of the reader. A setting
   * that is left out keeps the choices of the reader; one with no choices is not in the menu.
   */
  choices: Partial<ReaderChoices>
  /** The sizes that the font size buttons go through: from `min` to `max` px, each `step` times the one before. */
  fontSizeSteps: Partial<FontSizeSteps>
  /** Other EpubViewer options (e.g. `keyboard`, `wheel`, `cooldown`). Look-related ones, the margin among them, come from the settings. */
  viewer: Partial<ViewerOptions>
}

/** The choices of the settings that take any number. Other values can still be set with setSettings(): the menu then shows none as chosen. */
export type ReaderChoices = Record<'lineHeight' | 'maxWidth' | 'margin', [value: number, label: string][]>

export interface FontSizeSteps {
  min: number
  max: number
  /** How many times larger the next size is. */
  step: number
}

export interface OpenOptions {
  /**
   * Key for the saved reading position. Defaults to dc:identifier, then the URL or file name, then the title.
   * Give one when books share an identifier, e.g. per-episode EPUBs of the same novel.
   */
  key?: string
  /** Where to start. Overrides the saved position. */
  location?: BookTarget
}

const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'system',
  font: 'mincho',
  fontSize: 45, // large enough to read comfortably at a distance
  lineHeight: 0,
  maxWidth: 0,
  margin: 32,
  writingMode: 'auto',
  spread: 'auto',
  direction: 'auto',
}

const DEFAULT_CHOICES: ReaderChoices = {
  lineHeight: [[0, '本の指定'], [1.3, '狭い'], [1.6, '標準'], [1.9, '広い'], [2.2, 'とても広い']],
  maxWidth: [[0, '全幅'], [1400, '1400'], [1200, '1200'], [1000, '1000'], [800, '800'], [600, '600']],
  margin: [[16, '狭い'], [32, '標準'], [64, '広い'], [96, 'とても広い']],
}
const DEFAULT_FONT_SIZE_STEPS: FontSizeSteps = { min: 12, max: 120, step: 1.2 } // equal-looking steps at any size

/** Text of the app (a label of its choices), for the HTML of the toolbar. */
const escapeHtml = (text: unknown) => String(text).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

/** What the keys do while the focus is on the slider: the page turns of the viewer. */
const SEEK_KEYS: Record<string, 'goLeft' | 'goRight' | 'prev' | 'next' | undefined> = {
  ArrowLeft: 'goLeft',
  ArrowRight: 'goRight',
  ArrowUp: 'prev',
  ArrowDown: 'next',
  PageUp: 'prev',
  PageDown: 'next',
}

/** A row of the settings panel: radio buttons named after the setting, one per value. No row for a setting without values. */
const choices = (name: keyof ReaderSettings, label: string, options: [value: string | number, label: string, style?: string][]) => !options.length ? '' : `
  <div class="row">
    <span>${label}</span>
    <span class="choices" role="radiogroup" aria-label="${label}">
      ${options.map(([value, text, style = '']) => `<label><input type="radio" name="${name}" value="${escapeHtml(value)}"><span style="${style}">${escapeHtml(text)}</span></label>`).join('')}
    </span>
  </div>`
const swatch = ({ background, color }: Theme) => `background:${background};color:${color}`

// The two menus are <details>, so they open and close without any code. The settings are in a
// <form> to keep the radio button groups of several readers on one page apart. Settings that only
// work for one kind of book (reflowable text, or fixed-layout pages) are shown for that kind only,
// and the spread not for vertical text.
const toolbar = (offered: ReaderChoices) => `
  <details class="toc" hidden>
    <summary>目次</summary>
    <div class="panel toc-list"></div>
  </details>
  <span class="title"></span>
  <span class="progress"><span class="pages"></span><span class="percent"></span></span>
  <input type="range" class="seek" min="0" max="1" step="any" value="0" title="本の中の位置" aria-label="本の中の位置" hidden>
  <details class="settings">
    <summary title="表示設定" aria-label="表示設定">Aa</summary>
    <form class="panel">
      <div class="only-reflowable">
        <div class="row">
          <span>文字サイズ</span>
          <span class="choices">
            <button type="button" class="font-down" title="文字を小さく" aria-label="文字を小さく">A−</button>
            <output class="font-size"></output>
            <button type="button" class="font-up" title="文字を大きく" aria-label="文字を大きく">A＋</button>
          </span>
        </div>
        ${choices('font', 'フォント', [['mincho', '明朝'], ['gothic', 'ゴシック'], ['book', '本の指定']])}
        ${choices('lineHeight', '行間', offered.lineHeight)}
        ${choices('maxWidth', '表示幅', offered.maxWidth)}
        ${choices('margin', '余白', offered.margin)}
        ${choices('writingMode', '表示方向', [['auto', '自動'], ['vertical', '縦書き'], ['horizontal', '横書き']])}
      </div>
      <div class="not-vertical">
        ${choices('spread', '見開き', [['auto', '自動'], ['always', 'する'], ['never', 'しない']])}
      </div>
      <div class="only-pre-paginated">
        ${choices('direction', '開き方向', [['auto', '本の指定'], ['rtl', '右開き'], ['ltr', '左開き']])}
      </div>
      ${choices('theme', 'テーマ', [
        ['system', '自動'],
        ['light', 'ライト', swatch(themes.light)],
        ['sepia', 'セピア', swatch(themes.sepia)],
        ['dark', 'ダーク', swatch(themes.dark)],
      ])}
    </form>
  </details>`

// Scoped to .epub-reader so that it can live inside another app's page. The toolbar takes the
// colors of the page (--bg / --fg, set from the theme) so that it stays out of the way of the text.
// Lines and highlights are a translucent grey, which works on any theme. The CSS keeps to what the
// browsers that can run the library at all support (no :has(), no color-mix()); the container query
// and its unit are extras with fallbacks.
const STYLE = `
  .epub-reader {
    --line: rgb(128 128 128 / 0.35);
    --hover: rgb(128 128 128 / 0.16);
    container-type: size; /* for the container query and the cqh unit below */
    display: flex; flex-direction: column; height: 100%;
    background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif;
  }
  .epub-reader .toolbar {
    position: relative; z-index: 1; display: flex; gap: 4px; align-items: center;
    padding: 6px 10px; border-bottom: 1px solid var(--line);
  }
  .epub-reader .toolbar[hidden] { display: none; } /* the app may hide it, e.g. on a tap */
  /* Progress through the book, drawn over the border: a slider, to go to another place in it.
     The line is filled up to the place (from the right, where the pages go to the left).
     Only its thumb takes the pointer. A touch is given to a control near it: with the whole line
     taking it, a swipe that began at the top of the page moved the slider, and the place was lost. */
  .epub-reader .seek {
    --fill: linear-gradient(to right, var(--fg) calc(var(--progress, 0) * 100%), transparent 0);
    --thumb: 28px; /* a dot of 12px, with room around it for a finger */
    position: absolute; left: 0; bottom: calc(var(--thumb) / -2); box-sizing: border-box;
    width: 100%; height: var(--thumb); margin: 0; padding: 0;
    -webkit-appearance: none; appearance: none; background: none; pointer-events: none;
  }
  .epub-reader .seek[dir='rtl'] { --fill: linear-gradient(to left, var(--fg) calc(var(--progress, 0) * 100%), transparent 0); }
  .epub-reader .seek::-webkit-slider-runnable-track { height: 2px; background: var(--fill); }
  .epub-reader .seek::-moz-range-track { height: 2px; background: var(--fill); }
  .epub-reader .seek::-webkit-slider-thumb {
    -webkit-appearance: none; box-sizing: border-box; width: var(--thumb); height: var(--thumb); margin-top: calc(1px - var(--thumb) / 2);
    border: 8px solid transparent; border-radius: 50%; background: var(--fg) padding-box; cursor: pointer; pointer-events: auto;
  }
  .epub-reader .seek::-moz-range-thumb {
    box-sizing: border-box; width: var(--thumb); height: var(--thumb);
    border: 8px solid transparent; border-radius: 50%; background: var(--fg) padding-box; cursor: pointer; pointer-events: auto;
  }
  /* The focus is shown on the thumb: the box of the slider is as wide as the toolbar. */
  .epub-reader .toolbar .seek:focus-visible { outline: none; }
  .epub-reader .seek:focus-visible::-webkit-slider-thumb { border-color: var(--hover); }
  .epub-reader .seek:focus-visible::-moz-range-thumb { border-color: var(--hover); }
  .epub-reader :is(.toolbar > :is(button, select, a, label), summary, .panel button) {
    box-sizing: border-box; padding: 6px 10px; border: 0; border-radius: 8px;
    background: none; color: inherit; font: inherit; text-decoration: none; white-space: nowrap; cursor: pointer;
    transition: background-color 0.15s;
  }
  .epub-reader :is(.toolbar > :is(button, select, a, label), summary, .panel button):hover,
  .epub-reader .choices label:hover > span,
  .epub-reader details[open] > summary { background: var(--hover); }
  .epub-reader .toolbar :focus-visible,
  .epub-reader .choices :focus-visible + span { outline: 2px solid var(--fg); outline-offset: -2px; }
  .epub-reader summary { list-style: none; user-select: none; }
  .epub-reader summary::-webkit-details-marker { display: none; }
  /* Text in the toolbar: the title, the progress, and what the app adds (e.g. a status). */
  .epub-reader .toolbar > span { padding: 0 8px; white-space: nowrap; }
  .epub-reader .toolbar > span:empty { padding: 0; }
  .epub-reader .title {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
    text-align: center; font-weight: 600; letter-spacing: 0.02em;
  }
  .epub-reader .progress { opacity: 0.7; font-variant-numeric: tabular-nums; }
  /* On a narrow screen the room goes to the title; the bar under the toolbar shows the same. */
  @container (max-width: 480px) { .epub-reader .percent { display: none; } }
  .epub-reader .panel {
    position: absolute; top: calc(100% + 6px); z-index: 1; /* over the thumb of the slider, which reaches as far down */
    box-sizing: border-box; width: min(26em, 100% - 16px); max-height: 70vh; max-height: calc(100cqh - 100% - 14px); overflow: auto;
    padding: 6px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--bg); box-shadow: 0 2px 6px rgb(0 0 0 / 0.12), 0 12px 32px rgb(0 0 0 / 0.18);
  }
  /* A menu comes in with a small move, unless the reader has asked for less motion. */
  @keyframes epub-reader-menu { from { opacity: 0; transform: translateY(-4px); } }
  .epub-reader details[open] > .panel { animation: epub-reader-menu 0.12s ease-out; }
  @media (prefers-reduced-motion: reduce) { .epub-reader details[open] > .panel { animation: none; } }
  .epub-reader .toc .panel { left: 8px; }
  .epub-reader .settings .panel { right: 8px; display: grid; gap: 14px; width: min(34em, 100% - 16px); padding: 16px; }
  .epub-reader .toc-list button {
    display: block; width: 100%; padding-left: calc(10px + var(--depth) * 1em); text-align: start; white-space: normal;
  }
  .epub-reader .toc-list button:disabled { opacity: 0.6; cursor: default; background: none; } /* a heading that leads nowhere */
  /* The chapter being read: marked by a bar at its side as well. */
  .epub-reader .toc-list [aria-current] { background: var(--hover); font-weight: 600; box-shadow: inset 3px 0 var(--fg); }
  /* The groups of rows for one kind of book do not make a box of their own. */
  .epub-reader :is(.only-reflowable, .only-pre-paginated, .not-vertical) { display: contents; }
  .epub-reader[data-layout='pre-paginated'] .only-reflowable,
  .epub-reader[data-layout='reflowable'] .only-pre-paginated,
  .epub-reader[data-writing='vertical'] .not-vertical { display: none; }
  .epub-reader .row { display: grid; grid-template-columns: 5.5em 1fr; align-items: center; }
  .epub-reader .row > :first-child { opacity: 0.7; }
  .epub-reader .choices { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; }
  .epub-reader .choices label { position: relative; display: flex; }
  .epub-reader .choices :is(label > span, button) {
    padding: 5px 10px; border: 1px solid var(--line); border-radius: 999px;
    transition: background-color 0.15s, border-color 0.15s, color 0.15s;
  }
  /* The choice made: in the colors of the page, the other way round. */
  .epub-reader .choices input:checked + span { border-color: var(--fg); background-color: var(--fg); color: var(--bg); }
  /* A theme is shown in its own colors, so the one chosen has a ring around it instead. */
  .epub-reader .choices input:checked + span[style*='background'] { box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--fg); }
  /* The radio button itself is invisible and covers its label. */
  .epub-reader .choices input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
  .epub-reader .font-size { min-width: 2.5em; text-align: center; font-variant-numeric: tabular-nums; }
  .epub-reader .viewer { position: relative; flex: 1; min-height: 0; }
  /* While a menu is open, a cover over the page takes the click that closes it: clicks on the page
     itself stay inside its iframe, and would also turn the page. */
  .epub-reader.menu-open .viewer::after { content: ''; position: absolute; inset: 0; }`

/**
 * A ready-made reader UI: toolbar (table of contents, progress with a slider, and a settings menu for font size,
 * font, line height, width, margin, writing mode, spread, direction and theme) + EpubViewer, with settings
 * and reading positions saved in a storage. Add your own controls to `toolbar`, and use `viewer`
 * for events and navigation.
 */
export class EpubReader {
  /** The toolbar element; add your own buttons or links to it. */
  readonly toolbar: HTMLElement
  readonly viewer: EpubViewer
  #book?: Book
  readonly #root: HTMLElement
  readonly #storage: ReaderOptions['storage']
  readonly #storageKey: string
  readonly #fontSizeSteps: FontSizeSteps
  readonly #systemDark = matchMedia('(prefers-color-scheme: dark)')
  #settings: ReaderSettings
  #positionKey = ''
  /** The latest call of open(). */
  #opening?: Promise<Book>
  /** The document of the section shown (of a fixed-layout book: of one of its pages). */
  #page?: Document
  /** The progress shown for the page on the screen: the share of the book, and the pages. */
  #shown?: [fraction: number, pages: string]
  /** The section whose entry is marked in the table of contents. */
  #marked = -1
  /**
   * Marks the root while a menu is open, for the cover over the page. From the `open` attribute
   * itself: the toggle event comes too late for a click that follows right after the menu opens.
   */
  readonly #menuObserver = new MutationObserver(() => {
    this.#root.classList.toggle('menu-open', !!this.toolbar.querySelector('details[open]'))
  })

  /** `root` must have a height; the reader fills it. */
  constructor(
    root: HTMLElement,
    { storage = defaultStorage(), storageKey = 'epub-viewer', settings = {}, viewer = {}, choices: offered = {}, fontSizeSteps = {} }: Partial<ReaderOptions> = {},
  ) {
    const doc = root.ownerDocument
    if (!doc.getElementById('epub-reader-style')) {
      doc.head.append(Object.assign(doc.createElement('style'), { id: 'epub-reader-style', textContent: STYLE }))
    }
    root.classList.add('epub-reader')
    root.innerHTML = `<header class="toolbar">${toolbar({ ...DEFAULT_CHOICES, ...offered })}</header><div class="viewer"></div>`
    this.#root = root
    this.#storage = storage
    this.#storageKey = storageKey
    this.#fontSizeSteps = { ...DEFAULT_FONT_SIZE_STEPS, ...fontSizeSteps }
    this.toolbar = root.querySelector('.toolbar')!
    this.viewer = new EpubViewer(root.querySelector('.viewer')!, viewer)
    // Of what is saved, only settings of the right kind: a font size that is not a number could not be changed any more.
    const usable = ([key, value]: [string, unknown]) =>
      Object.hasOwn(DEFAULT_SETTINGS, key) && typeof value === typeof DEFAULT_SETTINGS[key as keyof ReaderSettings] && value === value
    const saved = Object.fromEntries(Object.entries(this.#load<object>('settings') ?? {}).filter(usable))
    this.#settings = { ...DEFAULT_SETTINGS, ...settings, ...saved }

    this.viewer.addEventListener('relocate', (e) => {
      const { index, page, pages, fraction, rtl } = e.detail
      // The pages of the section. A fixed-layout book has one page to a section, so there the sections are counted.
      const book = this.#book!
      const fixed = book.metadata.layout === 'pre-paginated'
      this.#shown = [fraction, fixed ? `${index + 1} / ${book.sections.length}` : `${page + 1} / ${pages}`]
      this.#showProgress(...this.#shown)
      // The slider goes the way the pages do: from the right for a book read from right to left.
      Object.assign(this.#part<HTMLInputElement>('seek'), { value: String(fraction), dir: rtl ? 'rtl' : 'ltr', hidden: false })
      this.#markCurrent(index)
      this.#save(`position:${this.#positionKey}`, this.viewer.location)
      // For the settings shown: a spread does nothing for vertical text, whose page is as wide as the screen already.
      const vertical = !fixed && this.#page?.defaultView?.getComputedStyle(this.#page.documentElement).writingMode.startsWith('vertical')
      root.dataset.writing = vertical ? 'vertical' : 'horizontal'
    })
    this.viewer.addEventListener('sectionload', (e) => (this.#page = e.detail.doc))
    this.toolbar.addEventListener('click', this.#onClick)
    this.toolbar.addEventListener('change', this.#onChange)
    this.toolbar.addEventListener('input', this.#onInput)
    // On the document: after a click that opens a menu, the focus is not in the toolbar. The
    // document gets a key before the window, where the viewer listens.
    doc.addEventListener('keydown', this.#onKeydown)
    this.toolbar.addEventListener('toggle', this.#onToggle, true) // toggle does not bubble
    this.toolbar.addEventListener('submit', (e) => e.preventDefault()) // Enter in the settings form
    doc.addEventListener('click', this.#dismiss)
    this.#menuObserver.observe(this.toolbar, { attributeFilter: ['open'], subtree: true })
    this.#systemDark.addEventListener('change', this.#apply) // follow the OS while theme is "system"
    this.#apply()
  }

  /** The book being shown. */
  get book(): Book | undefined {
    return this.#book
  }

  get settings(): Readonly<ReaderSettings> {
    return this.#settings
  }

  /**
   * Changes settings, as the toolbar does: for controls of your own. The changes are saved; only
   * changed settings are, so that the rest keeps following the initial settings given by the app.
   */
  setSettings(changes: Partial<ReaderSettings>): void {
    this.#settings = { ...this.#settings, ...changes }
    this.#save('settings', { ...this.#load<ReaderSettings>('settings'), ...changes })
    this.#apply()
  }

  /**
   * Opens a book at `options.location`, the saved position, or the beginning. When called again
   * before the book is ready, the later call wins, and both give the book of the later call.
   */
  open(source: BookSource, options: OpenOptions = {}): Promise<Book> {
    const opening: Promise<Book> = this.#open(source, options, () => opening === this.#opening)
    return (this.#opening = opening)
  }

  async #open(source: BookSource, { key, location }: OpenOptions, isLatest: () => boolean): Promise<Book> {
    const book = await openBook(source)
    // Not the latest call any more (or the reader has been destroyed): the book of the latest one is given instead.
    if (!isLatest()) {
      book.destroy()
      return this.#opening ?? book
    }
    // The book before is kept until this one is on the screen: if it cannot be shown, that one stays.
    const before = { book: this.#book, key: this.#positionKey }
    this.#book = book
    // A File is told by its name, not by `instanceof`: one dropped on the page comes from the iframe's realm.
    const name = typeof source === 'string' || source instanceof URL ? String(source) : (source as Partial<File>).name
    // Not all of a name of any length: it is the book's to choose, and the storage is not the reader's alone to fill.
    this.#positionKey = key ?? (book.metadata.identifier || name || book.metadata.title).slice(0, 200)
    // What is saved may not be a position (it is not ours alone to write): such a thing is not used.
    const saved = this.#load<BookLocation>(`position:${this.#positionKey}`)
    try {
      await this.viewer.open(book, location ?? (typeof saved?.index === 'number' && typeof saved.progress === 'number' ? saved : undefined))
    } catch (error) {
      book.destroy()
      if (this.#book === book) [this.#book, this.#positionKey] = [before.book, before.key]
      throw error
    }
    before.book?.destroy()
    if (!isLatest()) return this.#opening ?? book
    this.#part('title').textContent = book.metadata.title
    this.#root.dataset.layout = book.metadata.layout // for the settings shown
    this.#renderToc(book)
    if (this.viewer.location) this.#markCurrent(this.viewer.location.index)
    return book
  }

  /** Removes the reader from `root` and releases the book. */
  destroy(): void {
    this.#root.ownerDocument.removeEventListener('click', this.#dismiss)
    this.#root.ownerDocument.removeEventListener('keydown', this.#onKeydown)
    this.#systemDark.removeEventListener('change', this.#apply)
    this.#menuObserver.disconnect()
    this.#opening = undefined // a book that is still being opened is not shown
    this.viewer.destroy()
    this.#book?.destroy()
    this.#root.replaceChildren()
    this.#root.classList.remove('epub-reader', 'menu-open')
    for (const property of ['--bg', '--fg', '--progress', 'color-scheme']) this.#root.style.removeProperty(property)
    delete this.#root.dataset.layout
    delete this.#root.dataset.writing
  }

  #part<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.#root.querySelector(`.${name}`)!
  }

  #apply = (): void => {
    const settings = this.#settings
    const name = settings.theme === 'system' ? (this.#systemDark.matches ? 'dark' : 'light') : settings.theme
    // A saved setting may be a name that is not known (any more), or one that every object has ("constructor").
    const theme = Object.hasOwn(themes, name) ? themes[name] : themes.light
    const { style } = this.#root
    style.setProperty('--bg', theme.background)
    style.setProperty('--fg', theme.color)
    style.colorScheme = name === 'dark' ? 'dark' : 'light' // scroll bars etc.
    for (const input of this.toolbar.querySelectorAll<HTMLInputElement>('.settings input')) {
      input.checked = input.value === String(settings[input.name as keyof ReaderSettings])
    }
    this.#part('font-size').textContent = String(settings.fontSize)
    this.viewer.setOptions({
      theme,
      fontFamily: settings.font === 'book' ? '' : fonts[settings.font],
      fontSize: settings.fontSize,
      lineHeight: settings.lineHeight,
      maxWidth: settings.maxWidth,
      margin: settings.margin,
      writingMode: settings.writingMode,
      spread: settings.spread,
      direction: settings.direction,
    })
  }

  #onClick = (e: MouseEvent): void => {
    // The controls of the reader, and buttons added by the app; not other things that it adds (e.g. a text field).
    const control = (e.target as Element).closest<HTMLElement>('button, summary, .settings input, .seek')
    if (control?.matches('.font-up, .font-down')) {
      const { min, max, step } = this.#fontSizeSteps
      const size = this.#settings.fontSize
      // By a pixel at least: a small step, rounded, would leave a small size where it is.
      const next = control.matches('.font-up') ? Math.max(size + 1, Math.round(size * step)) : Math.min(size - 1, Math.round(size / step))
      this.setSettings({ fontSize: Math.min(max, Math.max(min, next)) })
    } else if (control?.matches('.toc-list button')) {
      this.#closeMenus()
      this.#goTo((control as HTMLButtonElement).value)
    } else if (control?.matches('.seek') && this.#shown && Number((control as HTMLInputElement).value) === this.#shown[0]) {
      this.#showProgress(...this.#shown) // the thumb was let go where it was taken: no move follows, to show the page again
    }
    // After a click with the mouse (detail > 0), keys go back to turning pages instead of operating
    // the control again. Keyboard and remote control users keep their place in the toolbar.
    if (e.detail) control?.blur()
  }

  /** Shows how far into the book: the pages (a count that depends on the kind of book), or only the share where they are not known. */
  #showProgress(fraction: number, pages?: string): void {
    const percent = `${Math.round(fraction * 100)}%`
    this.#part('pages').textContent = pages ?? percent
    this.#part('percent').textContent = pages ? `（${percent}）` : ''
    this.#root.style.setProperty('--progress', String(fraction))
  }

  /**
   * The thumb of the slider is being moved: the numbers follow it, and the move itself is made when
   * it is let go (see #onChange). The page can be told ahead for a fixed-layout book only, where
   * every section is one page: the pages of text are not known before a section is laid out.
   */
  #onInput = (e: Event): void => {
    const book = this.#book
    if (e.target !== this.#part('seek') || !book) return
    const fraction = Number((e.target as HTMLInputElement).value)
    const count = book.sections.length
    // The page that this much of the book ends on, as goTo({ fraction }) takes it.
    this.#showProgress(fraction, book.metadata.layout === 'pre-paginated' ? `${Math.max(1, Math.ceil(fraction * count - 1e-6))} / ${count}` : undefined)
  }

  /** A move that the user asked for in the toolbar. */
  #goTo(target: BookTarget): void {
    this.viewer.goTo(target).catch(this.#report)
  }

  /** A failure of such a move is reported like a failed page turn, for the app to show. */
  #report = (error: unknown): void => {
    this.viewer.dispatchEvent(new CustomEvent('error', { detail: { error } }))
  }

  #onChange = (e: Event): void => {
    const input = e.target
    if (input === this.#part('seek')) return this.#goTo({ fraction: Number((input as HTMLInputElement).value) })
    if (!(input instanceof HTMLInputElement) || !input.closest('.settings')) return // e.g. controls added by the app
    const key = input.name as keyof ReaderSettings
    this.setSettings({ [key]: typeof DEFAULT_SETTINGS[key] === 'number' ? Number(input.value) : input.value })
  }

  /**
   * Keys while a menu is open, wherever the focus is. The keys that turn pages are marked with
   * preventDefault(), so that the viewer leaves them alone: the page behind a menu does not turn.
   */
  #onKeydown = (e: KeyboardEvent): void => {
    // On the slider, the keys turn pages as they do elsewhere. Left to the browser, they move it by
    // a step that differs between browsers (in Firefox, by the whole book).
    const turn = e.target === this.#part('seek') && !(e.altKey || e.ctrlKey || e.metaKey) && Object.hasOwn(SEEK_KEYS, e.key) && SEEK_KEYS[e.key]
    if (turn) {
      e.preventDefault()
      this.viewer[turn]().catch(this.#report)
      return
    }
    const menu = this.toolbar.querySelector('details[open]')
    if (!menu) return
    const target = e.target as HTMLElement
    if (e.key === 'Escape') {
      e.preventDefault()
      this.#closeMenus()
      menu.querySelector('summary')!.focus()
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && target.matches('.toc-list button')) {
      e.preventDefault()
      // Headings that lead nowhere (disabled) cannot take the focus: on to the entry after them.
      const step = e.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling'
      let entry = target[step] as HTMLButtonElement | null
      while (entry?.disabled) entry = entry[step] as HTMLButtonElement | null
      entry?.focus()
    } else if (/^(Arrow|Page)/.test(e.key) ? !target.matches('input') : e.key === ' ' && !target.closest('button, summary, input')) {
      e.preventDefault() // not the arrow keys of the radio buttons, nor Space on a control
    }
  }

  #onToggle = (e: Event): void => {
    const menu = e.target as HTMLDetailsElement
    if (!menu.open) return
    this.#closeMenus(menu)
    const current = menu.querySelector<HTMLElement>('[aria-current]')
    if (!current) return
    // Center the current chapter in the list. Not scrollIntoView(), which may scroll the host page as well.
    const list = current.parentElement!
    list.scrollTop = current.offsetTop - (list.clientHeight - current.offsetHeight) / 2
    // Opened from the keyboard (a mouse click does not leave the focus on the menu): start at the current chapter.
    if (menu.contains(menu.ownerDocument.activeElement)) current.focus({ preventScroll: true })
  }

  /**
   * A click outside of a menu closes it. Not earlier, when the pointer is pressed: with a touch, the
   * click comes after the finger is lifted, and would go to the page that the closed menu's cover has left.
   */
  #dismiss = (e: Event): void => {
    this.#closeMenus((e.target as Element).closest?.('details'))
  }

  #closeMenus(except?: Element | null): void {
    for (const menu of this.toolbar.querySelectorAll<HTMLDetailsElement>('details[open]')) {
      if (menu !== except) menu.open = false
    }
  }

  #renderToc(book: Book): void {
    const sectionIndex = new Map(book.sections.map((section, index) => [section.href, index]))
    // Not a list of arguments (replaceChildren(...buttons)): their number has a limit, which a book can go past.
    const buttons = this.#root.ownerDocument.createDocumentFragment()
    const add = (items: TocItem[], depth: number) => {
      for (const item of items) {
        const button = this.#root.ownerDocument.createElement('button')
        Object.assign(button, { type: 'button', textContent: item.label, value: item.href, disabled: !item.href })
        button.style.setProperty('--depth', String(depth))
        button.dataset.index = String(sectionIndex.get(item.href.split('#')[0]) ?? -1)
        buttons.append(button)
        add(item.children, depth + 1)
      }
    }
    add(book.toc, 0)
    // A single entry leads nowhere but to the section already shown (e.g. a book of one episode).
    this.#part('toc').hidden = buttons.childElementCount < 2
    this.#part('toc-list').replaceChildren(buttons)
    this.#marked = -1
  }

  /** Marks the table of contents entry that the section at `index` belongs to: the last one at or before it. */
  #markCurrent(index: number): void {
    if (index === this.#marked) return // called at every page turn; the entry only changes with the section
    this.#marked = index
    let current: Element | undefined
    let best = -1
    for (const button of this.#part<HTMLElement>('toc-list').children as HTMLCollectionOf<HTMLButtonElement>) {
      button.removeAttribute('aria-current')
      const i = Number(button.dataset.index)
      // Of several entries for one section, the last one that is for the whole section: where a
      // chapter is followed by its episodes, the chapter links to the first episode. Entries for a
      // place inside the section (#...) are not taken: it is not known where in the section the page is.
      if (i >= 0 && i <= index && (i > best || (i === best && !button.value.includes('#')))) [current, best] = [button, i]
    }
    current?.setAttribute('aria-current', 'true')
  }

  // The storage may fail (it is full, or its content is not ours); the reader still works without it.
  #load<T>(name: string): T | undefined {
    try {
      return JSON.parse(this.#storage?.getItem(`${this.#storageKey}:${name}`) ?? 'null') ?? undefined
    } catch {
      return undefined
    }
  }

  #save(name: string, value: unknown): void {
    try {
      this.#storage?.setItem(`${this.#storageKey}:${name}`, JSON.stringify(value))
    } catch {}
  }
}

/** localStorage, where the browser lets the page use it (not in some private modes or sandboxed frames). */
function defaultStorage(): Storage | null {
  try {
    return localStorage
  } catch {
    return null
  }
}
