// Standalone reader app built on the library.
import { EpubViewer, openBook, themes, type Book, type TocItem, type ViewerOptions } from '../src/index.ts'

interface Settings {
  theme: 'system' | 'light' | 'dark'
  fontScale: number
  writingMode: ViewerOptions['writingMode']
}

const SETTINGS_KEY = 'epub-viewer:settings'
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// localStorage may be unavailable (private mode etc.); the app still works without it.
function load<T>(key: string): T | undefined {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? undefined
  } catch {
    return undefined
  }
}
function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

const systemDark = matchMedia('(prefers-color-scheme: dark)')
const settings: Settings = {
  theme: 'system',
  fontScale: 1,
  writingMode: 'auto',
  ...load<Settings>(SETTINGS_KEY),
}
const viewer = new EpubViewer($('viewer'))
let book: Book | undefined

// nepub EPUBs have no dc:identifier, so fall back to title + author.
const positionKey = (b: Book) =>
  `epub-viewer:position:${b.metadata.identifier || `${b.metadata.title}/${b.metadata.creator}`}`

function applySettings(): void {
  save(SETTINGS_KEY, settings)
  const theme = settings.theme === 'system' ? (systemDark.matches ? 'dark' : 'light') : settings.theme
  document.documentElement.dataset.theme = theme
  $<HTMLSelectElement>('theme').value = settings.theme
  $<HTMLSelectElement>('writing-mode').value = settings.writingMode
  viewer.setOptions({ theme: themes[theme], fontScale: settings.fontScale, writingMode: settings.writingMode })
}

async function open(source: Blob | string): Promise<void> {
  try {
    const next = await openBook(source)
    book?.destroy()
    book = next
    $('title').textContent = document.title = book.metadata.title
    renderToc(book.toc)
    $('placeholder').hidden = true
    await viewer.open(book, load(positionKey(book)))
  } catch (e) {
    alert(`EPUB を開けませんでした: ${e}`)
  }
}

function renderToc(items: TocItem[]): void {
  const options = [new Option('目次', '')]
  const add = (items: TocItem[], depth: number) => {
    for (const item of items) {
      options.push(new Option('　'.repeat(depth) + item.label, item.href))
      add(item.children, depth + 1)
    }
  }
  add(items, 0)
  const select = $<HTMLSelectElement>('toc')
  select.replaceChildren(...options)
  select.disabled = items.length === 0
}

viewer.addEventListener('relocate', (e) => {
  const { page, pages, fraction } = e.detail
  $('progress').textContent = `${page + 1} / ${pages}（${Math.round(fraction * 100)}%）`
  if (book) save(positionKey(book), viewer.location)
})

$<HTMLInputElement>('file').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) void open(file)
})
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (file) void open(file)
})
$<HTMLSelectElement>('toc').addEventListener('change', (e) => {
  const select = e.target as HTMLSelectElement
  if (select.value) void viewer.goTo(select.value)
  select.value = ''
  select.blur() // give arrow keys back to page turning
})
const bindSelect = <K extends 'theme' | 'writingMode'>(id: string, key: K) =>
  $<HTMLSelectElement>(id).addEventListener('change', (e) => {
    const select = e.target as HTMLSelectElement
    settings[key] = select.value as Settings[K]
    select.blur()
    applySettings()
  })
bindSelect('theme', 'theme')
bindSelect('writing-mode', 'writingMode')
systemDark.addEventListener('change', applySettings) // follow OS changes while theme is "system"
const changeFontScale = (delta: number) => {
  settings.fontScale = Math.min(3, Math.max(0.5, Math.round((settings.fontScale + delta) * 10) / 10))
  applySettings()
}
$('font-down').addEventListener('click', () => changeFontScale(-0.1))
$('font-up').addEventListener('click', () => changeFontScale(0.1))
// Keep focus off toolbar buttons so that Space turns pages instead of re-clicking the button.
document.addEventListener('click', (e) => {
  if (e.target instanceof HTMLButtonElement) e.target.blur()
})

applySettings()
const url = new URLSearchParams(location.search).get('url')
if (url) void open(url)
