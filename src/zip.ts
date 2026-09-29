/**
 * Minimal read-only ZIP reader for EPUB archives.
 * Supports "stored" and "deflate" entries (no ZIP64, no encryption).
 * Entries are read lazily from the Blob, so large files are not loaded into memory at once.
 */

interface Entry {
  method: number
  compressedSize: number
  size: number
  offset: number
}

export class ZipReader {
  readonly #blob: Blob
  readonly #entries: Map<string, Entry>

  private constructor(blob: Blob, entries: Map<string, Entry>) {
    this.#blob = blob
    this.#entries = entries
  }

  static async open(blob: Blob): Promise<ZipReader> {
    // The End Of Central Directory record is in the last 22 + (comment ≦ 65535) bytes.
    const tail = await view(blob, Math.max(0, blob.size - 22 - 0xffff), blob.size)
    let eocd = tail.byteLength - 22
    while (eocd >= 0 && tail.getUint32(eocd, true) !== 0x06054b50) eocd--
    if (eocd < 0) throw new Error('Not a ZIP file')

    const count = tail.getUint16(eocd + 10, true)
    const cdSize = tail.getUint32(eocd + 12, true)
    const cdOffset = tail.getUint32(eocd + 16, true)
    const cd = await view(blob, cdOffset, cdOffset + cdSize)
    const decoder = new TextDecoder()
    const entries = new Map<string, Entry>()
    for (let i = 0, p = 0; i < count; i++) {
      if (cd.getUint32(p, true) !== 0x02014b50) throw new Error('Broken ZIP central directory')
      const nameLength = cd.getUint16(p + 28, true)
      const name = decoder.decode(new Uint8Array(cd.buffer, p + 46, nameLength))
      entries.set(name, {
        method: cd.getUint16(p + 10, true),
        compressedSize: cd.getUint32(p + 20, true),
        size: cd.getUint32(p + 24, true),
        offset: cd.getUint32(p + 42, true),
      })
      p += 46 + nameLength + cd.getUint16(p + 30, true) + cd.getUint16(p + 32, true)
    }
    return new ZipReader(blob, entries)
  }

  has(name: string): boolean {
    return this.#entries.has(name)
  }

  /** Uncompressed size in bytes (0 if not found). */
  size(name: string): number {
    return this.#entries.get(name)?.size ?? 0
  }

  async read(name: string, type = ''): Promise<Blob> {
    const entry = this.#entries.get(name)
    if (!entry) throw new Error(`Not found in ZIP: ${name}`)
    const header = await view(this.#blob, entry.offset, entry.offset + 30)
    if (header.getUint32(0, true) !== 0x04034b50) throw new Error(`Broken ZIP entry: ${name}`)
    const start = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true)
    const data = this.#blob.slice(start, start + entry.compressedSize, type)
    if (entry.method === 0) return data
    if (entry.method === 8) {
      const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return new Blob([await new Response(stream).arrayBuffer()], { type })
    }
    throw new Error(`Unsupported ZIP compression method ${entry.method}: ${name}`)
  }
}

async function view(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, end).arrayBuffer())
}
