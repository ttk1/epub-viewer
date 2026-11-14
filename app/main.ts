// Standalone reader app: EpubReader plus opening books from a file, drag & drop or ?url=.
import { EpubReader, type BookSource } from '../src/index.ts'

const reader = new EpubReader(document.getElementById('reader')!)

// "Open" button, added to the reader's toolbar.
const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.epub,application/epub+zip', hidden: true })
const label = Object.assign(document.createElement('label'), { textContent: '開く' })
label.append(input)
reader.toolbar.prepend(label)

// The page itself takes the background of the theme. A phone shows the color of the page around
// it as well (behind the status bar and the bars of the browser): white, around a dark book.
const paint = () => (document.documentElement.style.background = reader.viewer.options.theme.background)
reader.toolbar.addEventListener('change', paint) // a theme chosen in the menu: the reader has applied it by now
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint) // the theme that follows the OS, likewise
paint()

async function open(source: BookSource): Promise<void> {
  try {
    const book = await reader.open(source)
    document.title = book.metadata.title
    document.getElementById('placeholder')!.hidden = true
  } catch (e) {
    alert(`EPUB を開けませんでした: ${e}`)
  }
}

input.addEventListener('change', () => {
  if (input.files?.[0]) void open(input.files[0])
})
function acceptDrops(doc: Document): void {
  doc.addEventListener('dragover', (e) => e.preventDefault())
  doc.addEventListener('drop', (e) => {
    e.preventDefault()
    const file = e.dataTransfer?.files[0]
    if (file) void open(file)
  })
}
// Most drops land on the page, which is a document of its own inside the reader's iframe:
// the empty one before a book is opened, then one per section.
acceptDrops(document)
acceptDrops(document.querySelector<HTMLIFrameElement>('#reader iframe')!.contentDocument!)
reader.viewer.addEventListener('sectionload', (e) => acceptDrops(e.detail.doc))
reader.viewer.addEventListener('error', (e) => alert(`ページを表示できませんでした: ${e.detail.error}`))

const url = new URLSearchParams(location.search).get('url')
if (url) void open(url)
