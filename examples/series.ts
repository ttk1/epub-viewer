// Example: one EPUB per episode. Turning past the last page opens the next episode;
// turning back past the first page opens the previous episode at its last page.
import { EpubViewer, openBook, type Book } from '../src/index.ts'

const episodes = ['../samples/episode-1.epub', '../samples/episode-2.epub', '../samples/episode-3.epub']
const viewer = new EpubViewer(document.getElementById('viewer')!)
let book: Book | undefined
let current = -1

async function show(index: number, atEnd = false): Promise<void> {
  const next = await openBook(episodes[index])
  book?.destroy()
  book = next
  current = index
  document.getElementById('status')!.textContent = `${book.metadata.title}（${index + 1} / ${episodes.length} 話）`
  await viewer.open(book, atEnd ? { index: book.sections.length - 1, progress: 1 } : undefined)
}

viewer.addEventListener('bookend', () => {
  if (current + 1 < episodes.length) void show(current + 1)
})
viewer.addEventListener('bookstart', () => {
  if (current > 0) void show(current - 1, true)
})

void show(0)
