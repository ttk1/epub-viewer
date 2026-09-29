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
