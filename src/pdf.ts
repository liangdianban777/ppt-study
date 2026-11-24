import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url&no-inline'

export type PdfDeck = {
  format: 'pdf'
  name: string
  pageCount: number
  pages: { page: PDFPageProxy; width: number; height: number }[]
  destroy: () => Promise<void>
}

GlobalWorkerOptions.workerSrc = workerUrl

export async function loadPdf(file: File): Promise<PdfDeck> {
  const assets = new URL('pdfjs/', document.baseURI).href
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${assets}cmaps/`,
    iccUrl: `${assets}iccs/`,
    standardFontDataUrl: `${assets}standard_fonts/`,
    wasmUrl: `${assets}wasm/`,
  })
  try {
    const pdf = await task.promise
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1)
      const { width, height } = page.getViewport({ scale: 1 })
      return { page, width, height }
    }))
    return { format: 'pdf', name: file.name.replace(/\.pdf$/i, ''), pageCount: pdf.numPages, pages, destroy: () => task.destroy() }
  } catch (error) {
    await task.destroy()
    throw error
  }
}
