import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import type { PresentationData } from '@aiden0z/pptx-renderer/browser'
import type { PdfDeck } from './pdf'

type Renderer = typeof import('@aiden0z/pptx-renderer/browser').renderSlide
export type PptxDeck = { format: 'pptx'; name: string; pageCount: number; model: PresentationData; renderSlide: Renderer }
export type Deck = PptxDeck | PdfDeck

export async function loadDeck(file: File): Promise<Deck> {
  if (/\.pdf$/i.test(file.name)) {
    const { loadPdf } = await import('./pdf')
    return loadPdf(file)
  }

  const [buffer, renderer] = await Promise.all([file.arrayBuffer(), import('@aiden0z/pptx-renderer/browser')])
  const files = await renderer.parseZipLazyMedia(buffer, renderer.RECOMMENDED_ZIP_LIMITS)
  const model = renderer.buildPresentation(files, { lazySlides: true })
  if (!model.slides.length) throw new Error('课件没有幻灯片')
  return { format: 'pptx', name: file.name.replace(/\.pptx$/i, ''), pageCount: model.slides.length, model, renderSlide: renderer.renderSlide }
}

export function useVisibleSlides(pane: RefObject<HTMLElement | null>, deck: Deck | null) {
  const [visible, setVisible] = useState<ReadonlySet<number>>(() => new Set())
  useEffect(() => {
    const root = pane.current
    if (!root || !deck) return
    const intersecting = new Set<number>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const page = Number((entry.target as HTMLElement).dataset.page)
        if (entry.isIntersecting) intersecting.add(page)
        else intersecting.delete(page)
      }
      setVisible(new Set(intersecting))
    }, { root, rootMargin: '160px 0px' })
    root.querySelectorAll(':scope > [data-page]').forEach(section => observer.observe(section))
    return () => observer.disconnect()
  }, [pane, deck])
  return visible
}
