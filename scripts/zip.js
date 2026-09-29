// Minimal ZIP writer, used to generate sample EPUBs and test data (Node.js only).
import { crc32, deflateRawSync } from 'node:zlib'

/**
 * @param {Array<[name: string, content: string | Uint8Array, store?: boolean]>} files
 * @returns {Buffer}
 */
export function createZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, content, store = false] of files) {
    const data = Buffer.from(content)
    const body = store ? data : deflateRawSync(data)
    const nameBytes = Buffer.from(name)
    const fields = (header, at) => {
      header.writeUInt16LE(0x0800, at) // UTF-8 file name
      header.writeUInt16LE(store ? 0 : 8, at + 2)
      header.writeUInt32LE(crc32(data), at + 8)
      header.writeUInt32LE(body.length, at + 12)
      header.writeUInt32LE(data.length, at + 16)
      header.writeUInt16LE(nameBytes.length, at + 20)
    }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    fields(local, 6)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    fields(central, 8)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBytes, body)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}
