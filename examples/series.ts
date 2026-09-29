// Example: one EPUB per episode. Turning past the last page opens the next episode;
// turning back past the first page opens the previous episode at its last page.
import { EpubViewer, openBook, type Book } from '../src/index.ts'

const episodes = ['../samples/episode-1.epub', '../samples/episode-2.epub', '../samples/episode-3.epub']
const viewer = new EpubViewer(document.getElementById('viewer')!)
let book: Book | undefined
let current = -1
// bookend / bookstart fire on every key press, so ignore them while an episode is loading.
let loading = false

async function show(index: number, atEnd = false): Promise<void> {
  if (loading || !episodes[index]) return
  loading = true
  try {
    const next = await openBook(episodes[index])
    book?.destroy()
    book = next
    current = index
    document.getElementById('status')!.textContent = `${book.metadata.title}（${index + 1} / ${episodes.length} 話）`
    await viewer.open(book, atEnd ? { index: -1, progress: 1 } : undefined)
  } finally {
    loading = false
  }
}

viewer.addEventListener('bookend', () => void show(current + 1))
viewer.addEventListener('bookstart', () => void show(current - 1, true))

void show(0)
