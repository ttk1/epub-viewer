import { ZipReader } from './zip.ts'

/** Anything `openBook` can read: a File/Blob, raw bytes, or a URL to fetch. */
export type BookSource = Blob | ArrayBuffer | Uint8Array | string | URL

export interface Metadata {
  /** dc:identifier (may be empty, e.g. for EPUBs made by nepub). */
  identifier: string
  title: string
  creator: string
  language: string
  /** "pre-paginated": a fixed-layout book, where every section is one page of a fixed size (e.g. manga). */
  layout: 'reflowable' | 'pre-paginated'
  /** The side that pages progress towards: "rtl" for books opened from the right (vertical text, manga). */
  direction: 'ltr' | 'rtl'
}

/** A spine item: one content document, in reading order. */
export interface Section {
  /** Path inside the archive, e.g. "OEBPS/text/ch1.xhtml". */
  href: string
  /** false for spine items marked linear="no" (skipped by next/prev). */
  linear: boolean
  /** Uncompressed size in bytes, used to estimate progress through the whole book. */
  size: number
  /** Fixed layout: the side of a two-page spread that the page belongs on, if the book says. */
  spread?: 'left' | 'right' | 'center'
}

export interface TocItem {
  label: string
  /** Archive path with optional fragment, e.g. "OEBPS/text/ch1.xhtml#sec2". Pass to `EpubViewer.goTo`. */
  href: string
  children: TocItem[]
}

const BASE = 'https://epub.invalid/'
const XHTML = 'http://www.w3.org/1999/xhtml'
const HTML_TYPES = ['application/xhtml+xml', 'text/html']
// frame-src / object-src: an SVG from the archive embedded with <iframe>/<object>/<embed> is a
// document of its own, same-origin with the host page, and WebKit does not pass this CSP down to it.
const CSP =
  "default-src blob: data:; style-src blob: data: 'unsafe-inline'; script-src 'none'; frame-src 'none'; object-src 'none'"

/**
 * Resolves `href` relative to the archive path `base`.
 * Returns "path#fragment" inside the archive, or undefined for external URLs (http:, mailto:, data:, ...)
 * and malformed ones.
 */
export function resolvePath(href: string, base: string): string | undefined {
  let url
  try {
    url = new URL(href, BASE + base.split('/').map(encodeURIComponent).join('/'))
  } catch {
    return undefined
  }
  if (!url.href.startsWith(BASE)) return undefined
  const path = url.pathname.slice(1) + url.hash
  try {
    return decodeURIComponent(path)
  } catch {
    return path // malformed escape such as a literal "%" in a file name
  }
}

export async function openBook(source: BookSource): Promise<Book> {
  const zip = await ZipReader.open(await toBlob(source))
  const readXml = async (path: string) => parseXml(await (await zip.read(path)).text())

  const container = await readXml('META-INF/container.xml')
  const opfPath = first(container, 'rootfile')?.getAttribute('full-path')
  if (!opfPath) throw new Error('rootfile not found in META-INF/container.xml')
  const opf = await readXml(opfPath)

  const items = new Map(
    all(opf, 'item').map((el) => [
      el.getAttribute('id') ?? '',
      {
        href: resolvePath(el.getAttribute('href') ?? '', opfPath) ?? '',
        // Without parameters ("; charset=..."), so that the kinds of files are told apart reliably.
        type: (el.getAttribute('media-type') ?? '').split(';')[0].trim().toLowerCase(),
        properties: (el.getAttribute('properties') ?? '').split(/\s+/),
      },
    ]),
  )
  const itemList = [...items.values()]

  const sections = all(opf, 'itemref').flatMap((el) => {
    const item = items.get(el.getAttribute('idref') ?? '')
    // Only (X)HTML: other documents (e.g. SVG) cannot carry the CSP that blocks their scripts.
    if (!item || !HTML_TYPES.includes(item.type)) return []
    const spread = el.getAttribute('properties')?.match(/page-spread-(left|right|center)/)?.[1] as Section['spread']
    return [{ href: item.href, linear: el.getAttribute('linear') !== 'no', size: zip.size(item.href), spread }]
  })

  const metas = all(opf, 'meta')
  const uid = first(opf, 'package')?.getAttribute('unique-identifier')
  const identifiers = all(opf, 'identifier')
  const metadata: Metadata = {
    identifier: text(identifiers.find((el) => el.getAttribute('id') === uid) ?? identifiers[0]),
    title: text(first(opf, 'title')),
    creator: text(first(opf, 'creator')),
    language: text(first(opf, 'language')),
    layout: metas.some((el) => el.getAttribute('property') === 'rendition:layout' && text(el) === 'pre-paginated')
      ? 'pre-paginated'
      : 'reflowable',
    direction: first(opf, 'spine')?.getAttribute('page-progression-direction') === 'rtl' ? 'rtl' : 'ltr',
  }

  // EPUB 3 navigation document, falling back to the EPUB 2 NCX.
  const nav = itemList.find((item) => item.properties.includes('nav'))
  const ncx = items.get(first(opf, 'spine')?.getAttribute('toc') ?? '')
  const readToc = async () => (nav ? parseNav(await readXml(nav.href), nav.href) : ncx ? parseNcx(await readXml(ncx.href), ncx.href) : [])
  // A book whose table of contents cannot be read (e.g. its file is missing) can still be read.
  const toc = await readToc().catch(() => [])

  const coverId = metas.find((el) => el.getAttribute('name') === 'cover')?.getAttribute('content')
  const cover = itemList.find((item) => item.properties.includes('cover-image')) ?? items.get(coverId ?? '')

  // A file listed more than once keeps the type of its first item.
  const types = new Map(itemList.reverse().map((item) => [item.href, item.type]))
  return new Book(zip, types, metadata, sections, toc, cover?.href)
}

export class Book {
  readonly #zip: ZipReader
  readonly #types: Map<string, string>
  readonly #cover?: string
  readonly #urls = new Map<string, Promise<string>>()
  /** The files shown as documents (the sections). */
  readonly #documents: Set<string>
  #destroyed = false
  /** For each file being rewritten, the files that it refers to: their URLs go into its own. */
  readonly #references = new Map<string, Set<string>>()

  /** Use `openBook()` instead of calling this directly. */
  constructor(
    zip: ZipReader,
    types: Map<string, string>,
    readonly metadata: Metadata,
    readonly sections: Section[],
    readonly toc: TocItem[],
    cover?: string,
  ) {
    this.#zip = zip
    this.#types = types
    this.#cover = cover
    this.#documents = new Set(sections.map((section) => section.href))
  }

  /** Cover image, if the book declares one. */
  async loadCover(): Promise<Blob | undefined> {
    return this.#cover ? this.#zip.read(this.#cover, this.#types.get(this.#cover)) : undefined
  }

  /**
   * Returns a URL (blob:) for a file in the archive, to use it as an image, a style sheet or a font. HTML and CSS are rewritten so that
   * their references (images, stylesheets, fonts) also point to blob: URLs.
   *
   * Files that can hold scripts (e.g. SVG images) get a data: URL instead: see #createUrl.
   */
  getUrl(path: string): Promise<string> {
    if (this.#destroyed) return Promise.reject(new Error('The book has been closed'))
    let url = this.#urls.get(path)
    if (!url) {
      url = this.#createUrl(path)
      this.#urls.set(path, url)
    }
    return url
  }

  /** Revokes all blob: URLs created by this book, and those that are still being made. No more can be had after this. */
  destroy(): void {
    this.#destroyed = true
    for (const url of this.#urls.values()) url.then((u) => URL.revokeObjectURL(u), () => {})
    this.#urls.clear()
  }

  async #createUrl(path: string): Promise<string> {
    const type = this.#types.get(path) ?? ''
    let blob = await this.#zip.read(path, type)
    const rewritten = this.#documents.has(path) || HTML_TYPES.includes(type) || type === 'text/css'
    if (this.#documents.has(path) || HTML_TYPES.includes(type)) {
      // A section is rewritten whatever the manifest calls it elsewhere: a file can be listed
      // twice, as a document and as something else. Shown as it is, its scripts would run.
      blob = await this.#rewriteHtml(await blob.text(), path, HTML_TYPES.includes(type) ? type : HTML_TYPES[0])
    } else if (type === 'text/css') {
      blob = textBlob(await this.#rewriteCss(await blob.text(), path), type)
    }
    // A blob: URL has the origin of the page. The reader can open any file of the book as a page
    // of its own (e.g. "open image in new tab"), where the scripts of an SVG would run with that
    // origin. So only files that cannot hold scripts get one, and the rest a data: URL, which
    // has an origin of its own.
    if (!rewritten && !INERT_TYPES.test(type)) {
      const reader = new FileReader()
      reader.readAsDataURL(blob)
      await new Promise((resolve, reject) => Object.assign(reader, { onload: resolve, onerror: reject }))
      return reader.result as string
    }
    const url = URL.createObjectURL(blob)
    if (this.#destroyed) URL.revokeObjectURL(url)
    return url
  }

  async #rewriteHtml(source: string, path: string, type: string): Promise<Blob> {
    const parse = (t: string, text = source) => new DOMParser().parseFromString(text, t as DOMParserSupportedType)
    let doc = parse(type)
    // Broken XHTML is common in the wild; fall back to the forgiving HTML parser. Likewise for a root
    // other than <html> (e.g. <svg>), where the CSP below would have no effect: the HTML parser puts it in a body.
    if (doc.querySelector('parsererror') || !(doc.documentElement instanceof HTMLHtmlElement)) {
      type = 'text/html'
      doc = parse(type)
    }
    // Scripts in the book must never run: the viewer iframe needs "allow-scripts" (see viewer.ts),
    // so they are blocked here by CSP. Only resources from the archive (blob:/data:) are loaded.
    const csp = doc.createElementNS(XHTML, 'meta')
    csp.setAttribute('http-equiv', 'Content-Security-Policy')
    csp.setAttribute('content', CSP)
    // The CSP only works inside <head>, and only on what comes after it: XHTML may have no <head>,
    // or a <script> before it.
    let head = doc.documentElement.firstElementChild
    if (!(head instanceof HTMLHeadElement)) {
      head = doc.createElementNS(XHTML, 'head')
      doc.documentElement.prepend(head)
    }
    head.prepend(csp)
    // <?xml-stylesheet?>: an XSLT stylesheet would replace the document with one that has no CSP.
    for (const node of [...doc.childNodes]) {
      if (node.nodeType === Node.PROCESSING_INSTRUCTION_NODE) node.remove()
    }
    // CSP does not cover <meta http-equiv="refresh">, which could navigate the page anywhere.
    for (const el of doc.querySelectorAll('meta[http-equiv]')) {
      if (isRefresh(el)) el.remove()
    }
    // The images in srcset would not be found (they are relative to a blob: URL now), and browsers
    // do not fall back to src then. So only src, which is rewritten below, is kept.
    for (const el of doc.querySelectorAll('[srcset]')) el.removeAttribute('srcset')
    // A <link> is a stylesheet and nothing else: other kinds have no use in a book, but can name a
    // server for the browser to connect to ahead of time (rel="preconnect"), which the CSP does
    // not stop in WebKit. Nor may a stylesheet be one of them as well (rel="stylesheet preconnect").
    for (const el of doc.querySelectorAll('link')) {
      const rel = relOf(el).filter((kind) => STYLESHEET_RELS.includes(kind))
      if (rel.includes('stylesheet')) el.setAttribute('rel', rel.join(' '))
      else el.remove()
    }
    for (const el of doc.querySelectorAll(UNSAFE_ELEMENTS)) el.remove()

    const targets = [
      ['[src]', 'src'],
      ['[poster]', 'poster'],
      ['link[href]', 'href'], // stylesheets only (see above): not rel="next" and the like, which would pull in the whole book
      ['image', 'href'],
      ['image', 'xlink:href'],
    ]
    await Promise.all([
      ...targets.flatMap(([selector, attr]) =>
        [...doc.querySelectorAll(selector)].map(async (el) => {
          const value = el.getAttribute(attr)
          if (value) el.setAttribute(attr, await this.#resolveUrl(value, path))
        }),
      ),
      ...[...doc.querySelectorAll('style')].map(async (el) => {
        el.textContent = await this.#rewriteCss(el.textContent ?? '', path)
      }),
      ...[...doc.querySelectorAll('[style]')].map(async (el) => {
        el.setAttribute('style', await this.#rewriteCss(el.getAttribute('style')!, path))
      }),
    ])
    if (type !== 'text/html') return textBlob(new XMLSerializer().serializeToString(doc), type)
    const html = `<!DOCTYPE html>${doc.documentElement.outerHTML}`
    // HTML does not always read back as it was written: text or a comment can come back as an
    // element (e.g. a <meta> that takes the page elsewhere). Nothing is shown of a document in
    // which something that was removed above is there again.
    const again = parse(type, html)
    const unsafe =
      again.querySelector(UNSAFE_ELEMENTS) ??
      [...again.querySelectorAll('meta[http-equiv]')].find(isRefresh) ??
      [...again.querySelectorAll('link')].find((link) => !isStylesheet(link))
    return textBlob(unsafe ? `<!DOCTYPE html><meta http-equiv="Content-Security-Policy" content="${CSP}">` : html, type)
  }

  async #rewriteCss(css: string, path: string): Promise<string> {
    // Old EPUBs often use only the -epub- prefixed properties, which browsers ignore.
    css = css
      .replace(/-epub-text-combine\s*:\s*horizontal/g, 'text-combine-upright: all')
      .replace(/-epub-(writing-mode|text-orientation|text-emphasis|word-break|line-break|hyphens)/g, '$1')
    // No "(" in a URL, and a limit on its length: without them, a long run of "url(" without
    // an end takes this a time that grows with the square of its length.
    // Nor white space in a URL without quotes (there is none in CSS): a run of spaces could be
    // matched both as the URL and as the space around it, in as many ways as it is long.
    const pattern = /url\(\s*(?:(['"])([^'"()]{1,4000})\1|([^'"()\s]{1,4000}))\s*\)|@import\s+(['"])([^'"]{1,4000})\4/g
    const urls = await Promise.all(
      [...css.matchAll(pattern)].map((m) => this.#resolveUrl((m[2] ?? m[3] ?? m[5]).trim(), path)),
    )
    let i = 0
    return css.replace(pattern, (match) => (match.startsWith('@') ? `@import "${urls[i++]}"` : `url("${urls[i++]}")`))
  }

  /** Converts a reference found in the file at `base` into a blob: URL (external URLs are kept as-is). */
  async #resolveUrl(href: string, base: string): Promise<string> {
    const [path, fragment] = resolvePath(href, base)?.split('#') ?? []
    // A reference back to the file itself is kept as it is, be it direct, e.g. url(#gradient), or
    // through other files, e.g. stylesheets that import each other: the URL of this file would have
    // to be known before it can be made, and waiting for it would never end.
    if (!path || !this.#zip.has(path) || this.#refersTo(path, base)) return href
    let references = this.#references.get(base)
    if (!references) this.#references.set(base, (references = new Set()))
    references.add(path)
    // A file that cannot be read is left out (e.g. an image shows as broken); the rest is still shown.
    const url = await this.getUrl(path).catch(() => undefined)
    return url ? url + (fragment ? `#${fragment}` : '') : href
  }

  /** Whether `from` is `target`, or refers to it through the references found so far. */
  #refersTo(from: string, target: string, seen = new Set<string>()): boolean {
    if (from === target) return true
    if (seen.has(from)) return false
    seen.add(from)
    return [...(this.#references.get(from) ?? [])].some((path) => this.#refersTo(path, target, seen))
  }
}

async function toBlob(source: BookSource): Promise<Blob> {
  if (source instanceof Blob) return source
  if (typeof source === 'string' || source instanceof URL) {
    const res = await fetch(source)
    if (!res.ok) throw new Error(`Failed to fetch ${source}: ${res.status}`)
    return res.blob()
  }
  return new Blob([source as BlobPart])
}

function parseXml(source: string): Document {
  const doc = new DOMParser().parseFromString(source, 'application/xml')
  return doc.querySelector('parsererror') ? new DOMParser().parseFromString(source, 'text/html') : doc
}

/**
 * Elements that are not the same when a document is rewritten (scripts are off) and when it is
 * shown (scripts are "on", only blocked), so that what is inside them escapes the rewriting:
 * <noscript> is text when shown, and a <template> can become a shadow root.
 */
const UNSAFE_ELEMENTS = 'noscript, template'
/** Types of files that cannot hold scripts, whatever is in them: bitmap images, fonts, audio and video. */
// The whole type must match: of "image/png,text/html", browsers take the part after the comma.
const INERT_TYPES = /^(image\/(png|jpe?g|gif|webp|avif|bmp)|(font|audio|video)\/[a-z0-9.-]+|application\/(font-[a-z0-9.-]+|x-font-[a-z0-9.-]+|vnd\.ms-opentype))$/
/** What the rel of a <link> may hold. */
const STYLESHEET_RELS = ['stylesheet', 'alternate']
const relOf = (link: Element) => (link.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
const isStylesheet = (link: Element) => relOf(link).includes('stylesheet') && relOf(link).every((kind) => STYLESHEET_RELS.includes(kind))
const isRefresh = (meta: Element) => meta.getAttribute('http-equiv')!.trim().toLowerCase() === 'refresh'

/**
 * A file of rewritten text. Marked as UTF-8 by a byte order mark, which browsers take over what
 * the text says about itself: a document that declares another encoding (e.g. <meta charset>)
 * would otherwise be read in that one, and not be the document that was rewritten. In ISO-2022-JP,
 * for one, escape sequences can make the CSP <meta> part of an attribute, and so remove it.
 */
const textBlob = (text: string, type: string) => new Blob(['\uFEFF', text], { type: `${type};charset=utf-8` })

// Namespace-agnostic helpers (OPF/NCX/XHTML use various prefixes).
const all = (node: Document | Element, name: string) => [...node.getElementsByTagNameNS('*', name)]
const first = (node: Document | Element, name: string): Element | undefined => all(node, name)[0]
const children = (el: Element, name: string) => [...el.children].filter((c) => c.localName === name)
const text = (el: Element | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

function parseNav(doc: Document, base: string): TocItem[] {
  const navs = all(doc, 'nav')
  const type = (el: Element) => el.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? el.getAttribute('epub:type')
  const nav = navs.find((el) => type(el)?.split(/\s+/).includes('toc')) ?? navs[0]
  const list = (ol: Element): TocItem[] =>
    children(ol, 'li').map((li) => {
      const label = children(li, 'a')[0] ?? children(li, 'span')[0]
      const href = label?.getAttribute('href')
      const sub = children(li, 'ol')[0]
      return {
        label: text(label),
        href: href ? (resolvePath(href, base) ?? '') : '',
        children: sub ? list(sub) : [],
      }
    })
  const ol = nav && children(nav, 'ol')[0]
  return ol ? list(ol) : []
}

function parseNcx(doc: Document, base: string): TocItem[] {
  const points = (parent: Element): TocItem[] =>
    children(parent, 'navPoint').map((point) => ({
      label: text(first(point, 'text')),
      href: resolvePath(first(point, 'content')?.getAttribute('src') ?? '', base) ?? '',
      children: points(point),
    }))
  const navMap = first(doc, 'navMap')
  return navMap ? points(navMap) : []
}
