// Standalone reader app: EpubReader plus opening books from a file, drag & drop or ?url=.
import { EpubReader, type BookSource } from '../src/index.ts'

const reader = new EpubReader(document.getElementById('reader')!)

// "Open" button, added to the reader's toolbar.
const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.epub,application/epub+zip', hidden: true })
const label = Object.assign(document.createElement('label'), { textContent: '開く' })
label.append(input)
reader.toolbar.prepend(label)

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
document.addEventListener('dragover', (e) => e.preventDefault())
document.addEventListener('drop', (e) => {
  e.preventDefault()
  const file = e.dataTransfer?.files[0]
  if (file) void open(file)
})
reader.viewer.addEventListener('error', (e) => alert(`ページを表示できませんでした: ${e.detail.error}`))

const url = new URLSearchParams(location.search).get('url')
if (url) void open(url)
