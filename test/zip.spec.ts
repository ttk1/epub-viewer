import { expect, test } from '@playwright/test'
import { createZip } from '../scripts/zip.js'
import { ZipReader } from '../src/zip.ts'

test('reads stored and deflated entries', async () => {
  const text = '縦書き'.repeat(1000)
  const zip = await ZipReader.open(new Blob([createZip([['mimetype', 'application/epub+zip', true], ['日本語/本文.txt', text]])]))
  expect(await (await zip.read('mimetype')).text()).toBe('application/epub+zip')
  expect(await (await zip.read('日本語/本文.txt', 'text/plain')).text()).toBe(text)
  expect(zip.size('日本語/本文.txt')).toBe(new TextEncoder().encode(text).length)
  expect(zip.has('missing')).toBe(false)
  await expect(zip.read('missing')).rejects.toThrow('Not found')
})

test('rejects non-ZIP data', async () => {
  await expect(ZipReader.open(new Blob(['not a zip']))).rejects.toThrow('Not a ZIP file')
})

test('stops inflating an entry that turns out larger than the archive declares', async () => {
  const zip = createZip([['bomb.txt', 'a'.repeat(1_000_000)]])
  // The uncompressed size in the central directory (at offset 24 of the entry header), set far too small.
  zip.writeUInt32LE(100, zip.lastIndexOf(Buffer.from('PK\x01\x02', 'latin1')) + 24)
  const reader = await ZipReader.open(new Blob([zip]))
  await expect(reader.read('bomb.txt')).rejects.toThrow('larger than declared')
})
