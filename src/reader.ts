import { openBook, type Book, type BookSource, type TocItem } from './book.ts'
import { EpubViewer, fonts, themes, type Location, type Theme, type ViewerOptions } from './viewer.ts'

/** Settings the user changes from the toolbar. Saved in localStorage and shared by all books. */
export interface ReaderSettings {
  /** "system" follows the OS dark mode setting. */
  theme: 'system' | 'light' | 'sepia' | 'dark'
  /** "book" keeps the book's own fonts. */
  font: 'mincho' | 'gothic' | 'book'
  fontSize: number
  /** Line height as a multiple of the font size. */
  lineHeight: number
  /** Page width in px, 0 = full width. */
  maxWidth: number
  writingMode: ViewerOptions['writingMode']
  /** Two pages (fixed layout) or two columns (horizontal text) side by side. */
  spread: ViewerOptions['spread']
}

export interface ReaderOptions {
  /** Prefix of the localStorage keys for settings and reading positions. "" disables saving. */
  storageKey: string
  /** Initial settings, used until the user changes them. */
  settings: Partial<ReaderSettings>
  /** Other EpubViewer options (e.g. `keyboard`, `wheel`, `cooldown`). Look-related ones come from the settings. */
  viewer: Partial<ViewerOptions>
}

export interface OpenOptions {
  /**
   * Key for the saved reading position. Defaults to dc:identifier, then the URL or file name.
   * Give one when books share an identifier, e.g. per-episode EPUBs of the same novel.
   */
  key?: string
  /** Where to start (a Location or a TocItem href). Overrides the saved position. */
  location?: Location | string
}

const DEFAULT_SETTINGS: ReaderSettings = {
  theme: 'system',
  font: 'mincho',
  fontSize: 45, // large enough to read comfortably at a distance
  lineHeight: 1.6,
  maxWidth: 0,
  writingMode: 'auto',
  spread: 'auto',
}

/** A row of the settings panel: radio buttons named after the setting, one per value. */
const choices = (name: keyof ReaderSettings, label: string, options: [value: string | number, label: string, style?: string][]) => `
  <div class="row">
    <span>${label}</span>
    <span class="choices" role="radiogroup" aria-label="${label}">
      ${options.map(([value, text, style = '']) => `<label><input type="radio" name="${name}" value="${value}"><span style="${style}">${text}</span></label>`).join('')}
    </span>
  </div>`
const swatch = ({ background, color }: Theme) => `background:${background};color:${color}`

// The two menus are <details>, so they open and close without any code. The settings are in a
// <form> to keep the radio button groups of several readers on one page apart.
const TOOLBAR = `
  <details class="toc" hidden>
    <summary>目次</summary>
    <div class="panel toc-list"></div>
  </details>
  <span class="title"></span>
  <span class="progress"><span class="pages"></span><span class="percent"></span></span>
  <details class="settings">
    <summary title="表示設定" aria-label="表示設定">Aa</summary>
    <form class="panel">
      <div class="row">
        <span>文字サイズ</span>
        <span class="choices">
          <button type="button" class="font-down" title="文字を小さく">A−</button>
          <output class="font-size"></output>
          <button type="button" class="font-up" title="文字を大きく">A＋</button>
        </span>
      </div>
      ${choices('font', 'フォント', [['mincho', '明朝'], ['gothic', 'ゴシック'], ['book', '本の指定']])}
      ${choices('lineHeight', '行間', [[1.3, '狭い'], [1.6, '標準'], [1.9, '広い'], [2.2, 'とても広い']])}
      ${choices('maxWidth', '表示幅', [[0, '全幅'], [1400, '1400'], [1200, '1200'], [1000, '1000'], [800, '800'], [600, '600']])}
      ${choices('writingMode', '表示方向', [['auto', '自動'], ['vertical', '縦書き'], ['horizontal', '横書き']])}
      ${choices('spread', '見開き', [['auto', '自動'], ['always', 'する'], ['never', 'しない']])}
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
    position: relative; z-index: 1; display: flex; gap: 2px; align-items: center;
    padding: 4px 8px; border-bottom: 1px solid var(--line);
  }
  /* Progress through the book, drawn over the border. */
  .epub-reader .toolbar::after {
    content: ''; position: absolute; left: 0; bottom: -1px; width: calc(var(--progress, 0) * 100%); height: 2px;
    background: var(--fg); opacity: 0.5; transition: width 0.2s;
  }
  .epub-reader :is(.toolbar > :is(button, select, a, label), summary, .panel button) {
    box-sizing: border-box; padding: 6px 10px; border: 0; border-radius: 6px;
    background: none; color: inherit; font: inherit; text-decoration: none; white-space: nowrap; cursor: pointer;
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
    text-align: center; font-weight: 600;
  }
  .epub-reader .progress { opacity: 0.7; font-variant-numeric: tabular-nums; }
  /* On a narrow screen the room goes to the title; the bar under the toolbar shows the same. */
  @container (max-width: 480px) { .epub-reader .percent { display: none; } }
  .epub-reader .panel {
    position: absolute; top: calc(100% + 6px); box-sizing: border-box;
    width: min(26em, 100% - 16px); max-height: 70vh; max-height: calc(100cqh - 100% - 14px); overflow: auto;
    padding: 6px; border: 1px solid var(--line); border-radius: 10px;
    background: var(--bg); box-shadow: 0 8px 24px rgb(0 0 0 / 0.2);
  }
  .epub-reader .toc .panel { left: 8px; }
  .epub-reader .settings .panel { right: 8px; display: grid; gap: 12px; width: min(32em, 100% - 16px); padding: 14px; }
  .epub-reader .toc-list button {
    display: block; width: 100%; padding-left: calc(10px + var(--depth) * 1em); text-align: start; white-space: normal;
  }
  .epub-reader .toc-list [aria-current] { background: var(--hover); font-weight: 600; }
  .epub-reader .row { display: grid; grid-template-columns: 5.5em 1fr; align-items: center; }
  .epub-reader .row > :first-child { opacity: 0.7; }
  .epub-reader .choices { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .epub-reader .choices label { position: relative; display: flex; }
  .epub-reader .choices :is(label > span, button) { padding: 5px 8px; border: 1px solid var(--line); border-radius: 6px; }
  .epub-reader .choices :checked + span { border-color: var(--fg); box-shadow: 0 0 0 1px var(--fg); }
  /* The radio button itself is invisible and covers its label. */
  .epub-reader .choices input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
  .epub-reader .font-size { min-width: 2.5em; text-align: center; font-variant-numeric: tabular-nums; }
  .epub-reader .viewer { position: relative; flex: 1; min-height: 0; }
  /* While a menu is open, a cover over the page takes the click that closes it: clicks on the page
     itself stay inside its iframe, and would also turn the page. */
  .epub-reader.menu-open .viewer::after { content: ''; position: absolute; inset: 0; }`

/**
 * A ready-made reader UI: toolbar (table of contents, progress, and a settings menu for font size,
 * font, width, writing mode and theme) + EpubViewer, with settings and reading positions saved in
 * localStorage. Add your own controls to `toolbar`, and use `viewer` for events and navigation.
 */
export class EpubReader {
  /** The toolbar element; add your own buttons or links to it. */
  readonly toolbar: HTMLElement
  readonly viewer: EpubViewer
  #book?: Book
  readonly #root: HTMLElement
  readonly #storageKey: string
  readonly #systemDark = matchMedia('(prefers-color-scheme: dark)')
  #settings: ReaderSettings
  #positionKey = ''
  /** The latest call of open(). */
  #opening?: Promise<Book>
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
  constructor(root: HTMLElement, { storageKey = 'epub-viewer', settings = {}, viewer = {} }: Partial<ReaderOptions> = {}) {
    const doc = root.ownerDocument
    if (!doc.getElementById('epub-reader-style')) {
      doc.head.append(Object.assign(doc.createElement('style'), { id: 'epub-reader-style', textContent: STYLE }))
    }
    root.classList.add('epub-reader')
    root.innerHTML = `<header class="toolbar">${TOOLBAR}</header><div class="viewer"></div>`
    this.#root = root
    this.#storageKey = storageKey
    this.toolbar = root.querySelector('.toolbar')!
    this.viewer = new EpubViewer(root.querySelector('.viewer')!, viewer)
    this.#settings = { ...DEFAULT_SETTINGS, ...settings, ...this.#load<ReaderSettings>('settings') }

    this.viewer.addEventListener('relocate', (e) => {
      const { index, page, pages, fraction } = e.detail
      this.#part('pages').textContent = `${page + 1} / ${pages}`
      this.#part('percent').textContent = `（${Math.round(fraction * 100)}%）`
      root.style.setProperty('--progress', String(fraction))
      this.#markCurrent(index)
      this.#save(`position:${this.#positionKey}`, this.viewer.location)
    })
    this.toolbar.addEventListener('click', this.#onClick)
    this.toolbar.addEventListener('change', this.#onChange)
    this.toolbar.addEventListener('keydown', this.#onKeydown)
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
    if (!isLatest()) {
      book.destroy()
      return this.#opening!
    }
    this.#book?.destroy()
    this.#book = book
    // A File is told by its name, not by `instanceof`: one dropped on the page comes from the iframe's realm.
    const name = typeof source === 'string' || source instanceof URL ? String(source) : (source as Partial<File>).name
    this.#positionKey = key ?? (book.metadata.identifier || name || book.metadata.title)
    this.#part('title').textContent = book.metadata.title
    this.#renderToc(book)
    await this.viewer.open(book, location ?? this.#load(`position:${this.#positionKey}`))
    return book
  }

  /** Removes the reader from `root` and releases the book. */
  destroy(): void {
    this.#root.ownerDocument.removeEventListener('click', this.#dismiss)
    this.#systemDark.removeEventListener('change', this.#apply)
    this.#menuObserver.disconnect()
    this.viewer.destroy()
    this.#book?.destroy()
    this.#root.replaceChildren()
    this.#root.classList.remove('epub-reader', 'menu-open')
    for (const property of ['--bg', '--fg', '--progress', 'color-scheme']) this.#root.style.removeProperty(property)
  }

  #part<T extends HTMLElement = HTMLElement>(name: string): T {
    return this.#root.querySelector(`.${name}`)!
  }

  #apply = (): void => {
    const settings = this.#settings
    const name = settings.theme === 'system' ? (this.#systemDark.matches ? 'dark' : 'light') : settings.theme
    const theme = themes[name]
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
      writingMode: settings.writingMode,
      spread: settings.spread,
    })
  }

  #onClick = (e: MouseEvent): void => {
    const control = (e.target as Element).closest<HTMLElement>('button, summary, input')
    if (control?.matches('.font-up, .font-down')) {
      const ratio = control.matches('.font-up') ? 1.2 : 1 / 1.2 // equal-looking steps at any size
      this.setSettings({ fontSize: Math.min(120, Math.max(12, Math.round(this.#settings.fontSize * ratio))) })
    } else if (control?.matches('.toc-list button')) {
      this.#closeMenus()
      // Reported like a failed page turn, for the app to show.
      this.viewer.goTo((control as HTMLButtonElement).value).catch((error: unknown) => {
        this.viewer.dispatchEvent(new CustomEvent('error', { detail: { error } }))
      })
    }
    // After a click with the mouse (detail > 0), keys go back to turning pages instead of operating
    // the control again. Keyboard and remote control users keep their place in the toolbar.
    if (e.detail) control?.blur()
  }

  #onChange = (e: Event): void => {
    const input = e.target
    if (!(input instanceof HTMLInputElement) || !input.closest('.settings')) return // e.g. controls added by the app
    const key = input.name as keyof ReaderSettings
    this.setSettings({ [key]: typeof DEFAULT_SETTINGS[key] === 'number' ? Number(input.value) : input.value })
  }

  /** Keys inside the menus. Handled keys are marked with preventDefault(), so they don't turn pages. */
  #onKeydown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement
    const menu = target.closest('details[open]')
    if (e.key === 'Escape' && menu) {
      e.preventDefault()
      this.#closeMenus()
      menu.querySelector('summary')!.focus()
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && target.matches('.toc-list button')) {
      e.preventDefault()
      const next = e.key === 'ArrowDown' ? target.nextElementSibling : target.previousElementSibling
      ;(next as HTMLElement | null)?.focus()
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
    const buttons: HTMLButtonElement[] = []
    const add = (items: TocItem[], depth: number) => {
      for (const item of items) {
        const button = this.#root.ownerDocument.createElement('button')
        Object.assign(button, { type: 'button', textContent: item.label, value: item.href, disabled: !item.href })
        button.style.setProperty('--depth', String(depth))
        button.dataset.index = String(sectionIndex.get(item.href.split('#')[0]) ?? -1)
        buttons.push(button)
        add(item.children, depth + 1)
      }
    }
    add(book.toc, 0)
    this.#part('toc-list').replaceChildren(...buttons)
    this.#marked = -1
    // A single entry leads nowhere but to the section already shown (e.g. a book of one episode).
    this.#part('toc').hidden = buttons.length < 2
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
      // place inside the section (#...) are not taken: where in the section the page is is not known.
      if (i <= index && (i > best || (i === best && !button.value.includes('#')))) [current, best] = [button, i]
    }
    current?.setAttribute('aria-current', 'true')
  }

  // localStorage may be unavailable (private mode etc.); the reader still works without it.
  #load<T>(name: string): T | undefined {
    if (!this.#storageKey) return undefined
    try {
      return JSON.parse(localStorage.getItem(`${this.#storageKey}:${name}`) ?? 'null') ?? undefined
    } catch {
      return undefined
    }
  }

  #save(name: string, value: unknown): void {
    if (!this.#storageKey) return
    try {
      localStorage.setItem(`${this.#storageKey}:${name}`, JSON.stringify(value))
    } catch {}
  }
}
