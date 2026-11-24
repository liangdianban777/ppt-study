import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { SlideHandle } from '@aiden0z/pptx-renderer/browser'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import type { Example } from './study-content'
import type { Deck, PptxDeck } from './deck'
import type { PdfDeck } from './pdf'

export const SlidePage = memo(function SlidePage({ page, active, title, example, deck, preview, onNavigate }: {
  page: number
  active: boolean
  title?: string
  example?: Example
  deck: Deck | null
  preview: boolean
  onNavigate: (page: number) => void
}) {
  const pdfPage = deck?.format === 'pdf' ? deck.pages[page - 1] : null
  const size = pdfPage ?? (deck?.format === 'pptx' ? deck.model : null)
  const ratio = size ? size.width / size.height : 16 / 9
  return (
    <section data-page={page} className={`page-section${active ? ' active' : ''}`} style={{ '--slide-ratio': ratio } as CSSProperties} aria-current={active ? 'page' : undefined}>
      <div className="slide-card">
        <div className="slide-stage" style={{ aspectRatio: ratio }}>
          {example ? <ExampleSlide item={example} /> : null}
          {preview && pdfPage ? <PdfPreview item={pdfPage} page={page} /> : null}
          {preview && deck?.format === 'pptx' ? <PptxPreview deck={deck} page={page} onNavigate={onNavigate} /> : null}
        </div>
        <p className="slide-meta"><span>第 {page} 页</span>{title ? <span>{title}</span> : null}</p>
      </div>
    </section>
  )
})

function ExampleSlide({ item }: { item: Example }) {
  return (
    <div className="demo-slide">
      <p className="demo-kicker">学习方法</p>
      <h4>{item.title}</h4>
      <p className="demo-caption">{item.subtitle}</p>
      <div className="demo-diagram">
        {item.diagram.map(([title, detail]) => <div className="demo-block" key={title}><b>{title}</b><span>{detail}</span></div>)}
      </div>
    </div>
  )
}

function PdfPreview({ item, page }: { item: PdfDeck['pages'][number]; page: number }) {
  const host = useRef<HTMLCanvasElement>(null)
  const [failedPage, setFailedPage] = useState<PDFPageProxy | null>(null)
  useEffect(() => {
    const canvas = host.current!
    const context = canvas.getContext('2d')!
    const buffer = document.createElement('canvas')
    let task: RenderTask | undefined
    let resizeTimer: number | undefined
    let observedWidth = 0

    function renderAtWidth(width: number) {
      const previous = task
      task = undefined
      previous?.cancel()
      if (width === canvas.width) {
        buffer.width = 0
        return
      }

      // 调整宽度时先用 CSS 缩放已绘制的页面，新图绘制完成后再更新可见画布。
      const viewport = item.page.getViewport({ scale: width / item.width })
      buffer.width = width
      buffer.height = Math.ceil(viewport.height)
      const render = item.page.render({ canvas: buffer, viewport })
      task = render
      void render.promise.then(() => {
        if (task !== render) return
        task = undefined
        canvas.width = buffer.width
        canvas.height = buffer.height
        context.drawImage(buffer, 0, 0)
        buffer.width = 0
        setFailedPage(null)
      }, (error: unknown) => {
        if (task !== render) return
        task = undefined
        buffer.width = 0
        if (!canvas.width) setFailedPage(item.page)
        console.warn('PDF 预览失败', error)
      })
    }

    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width * window.devicePixelRatio)
      if (!width || width === observedWidth) return
      const firstSize = observedWidth === 0
      observedWidth = width
      window.clearTimeout(resizeTimer)
      if (firstSize) renderAtWidth(width)
      else resizeTimer = window.setTimeout(() => renderAtWidth(width), 120)
    })
    observer.observe(canvas)
    return () => {
      const render = task
      task = undefined
      observer.disconnect()
      window.clearTimeout(resizeTimer)
      render?.cancel()
      item.page.cleanup()
      buffer.width = 0
      canvas.width = 0
      canvas.height = 0
    }
  }, [item])
  const failed = failedPage === item.page
  return <>
    <canvas ref={host} className="slide-pdf" width={0} height={0} role="img" aria-label={`PDF 第 ${page} 页`} style={{ visibility: failed ? 'hidden' : undefined }} />
    {failed ? <p className="render-message">第 {page} 页无法预览，请在 PDF 阅读器中查看。</p> : null}
  </>
}

function PptxPreview({ deck, page, onNavigate }: { deck: PptxDeck; page: number; onNavigate: (page: number) => void }) {
  const host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = host.current!
    const stage = element.parentElement!
    const { model, renderSlide } = deck
    let handle: SlideHandle | undefined
    let disposed = false
    let observer: ResizeObserver | undefined
    const showError = (error: unknown) => {
      if (disposed) return
      const detail = document.createElement('p')
      detail.className = 'render-message'
      detail.textContent = `第 ${page} 页无法预览，请在 PowerPoint 中查看。`
      element.replaceChildren(detail)
      console.warn('PPT 预览失败', error)
    }
    try {
      handle = renderSlide(model, model.slides[page - 1], {
        externalMedia: 'block',
        onNavigate: ({ slideIndex }) => { if (slideIndex !== undefined) onNavigate(slideIndex + 1) },
      })
      element.replaceChildren(handle.element)
      // 较旧的浏览器不支持在 calc() 中用两个长度相除。
      if (!CSS.supports('transform', 'scale(calc(1px / 1px))')) {
        const fit = (width: number) => { element.style.transform = `scale(${width / model.width})` }
        fit(stage.getBoundingClientRect().width)
        observer = new ResizeObserver(([entry]) => fit(entry.contentRect.width))
        observer.observe(stage)
      }
      void handle.ready.catch(showError)
    } catch (error) {
      showError(error)
    }
    return () => {
      disposed = true
      observer?.disconnect()
      handle?.dispose()
      element.replaceChildren()
    }
  }, [deck, page, onNavigate])
  return <div className="slide-native" ref={host} style={{ '--slide-native-width': `${deck.model.width}px` } as CSSProperties} />
}
