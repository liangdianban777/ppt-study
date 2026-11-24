import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { UIEvent } from 'react'
import { followScroll, isFollowedScroll, stopScroll } from './scroll-motion'
import type { ScrollMotion } from './scroll-motion'

const columns = ['slides', 'notes'] as const
type Column = (typeof columns)[number]

function sectionTop(pane: HTMLElement, section: HTMLElement) {
  return section.getBoundingClientRect().top - pane.getBoundingClientRect().top - parseFloat(getComputedStyle(pane).paddingTop)
}

function readingLine(pane: HTMLElement, column: Column) {
  const padding = parseFloat(getComputedStyle(pane).paddingTop)
  const height = pane.clientHeight - padding
  // 讲解使用靠近顶部的阅读线，避免长讲解提前带动课件切页。
  const offset = column === 'slides' ? height / 2 : Math.min(90, height * 0.24)
  return pane.getBoundingClientRect().top + padding + offset
}

function slideCenterOffset(pane: HTMLElement, section: HTMLElement) {
  const card = section.firstElementChild!.getBoundingClientRect()
  return card.top + card.height / 2 - readingLine(pane, 'slides')
}

function sectionFor(pane: HTMLElement, page: number) {
  return pane.querySelector<HTMLElement>(`:scope > [data-page="${page}"]`)
}

function visiblePage(pane: HTMLElement, column: Column) {
  const sections = pane.children as HTMLCollectionOf<HTMLElement>
  if (!sections[0]?.dataset.page) return 0

  const marker = readingLine(pane, column)
  let left = 0
  let right = sections.length - 1
  while (left < right) {
    const mid = Math.ceil((left + right) / 2)
    const boundary = column === 'slides'
      ? (sections[mid - 1].firstElementChild!.getBoundingClientRect().bottom + sections[mid].firstElementChild!.getBoundingClientRect().top) / 2
      : sections[mid].getBoundingClientRect().top
    if (boundary <= marker) left = mid
    else right = mid - 1
  }
  return Number(sections[left].dataset.page)
}

export function usePageSync(pages: number[], demo: boolean, readingNotes: boolean) {
  const slides = useRef<HTMLDivElement>(null)
  const notes = useRef<HTMLDivElement>(null)
  const slideSettleTimer = useRef<number | undefined>(undefined)
  const motions = useRef<Record<Column, ScrollMotion>>({ slides: {}, notes: {} })
  const active = useRef(0)
  const previousDemo = useRef(demo)
  const [selection, setSelection] = useState({ page: 0, demo })
  const current = selection.demo === demo && pages.includes(selection.page) ? selection.page : pages[0] ?? 0
  if (selection.demo !== demo || (selection.page && selection.page !== current)) setSelection({ page: current, demo })

  const moveTo = useCallback((column: Column, page: number, animate: boolean) => {
    if (column === 'slides') window.clearTimeout(slideSettleTimer.current)
    const pane = (column === 'slides' ? slides : notes).current
    if (!pane) return
    const section = sectionFor(pane, page)
    if (!section) return
    const offset = column === 'slides' ? slideCenterOffset(pane, section) : sectionTop(pane, section)
    followScroll(pane, motions.current[column], pane.scrollTop + offset, animate)
  }, [])

  useLayoutEffect(() => {
    const slidePane = slides.current!
    const notePane = notes.current!
    const observer = new ResizeObserver(entries => {
      for (const { target } of entries) {
        const pane = target as HTMLElement
        const column = pane === slidePane ? 'slides' : 'notes'
        const height = paneHeight(pane)
        const heightChanged = pane.style.getPropertyValue('--pane-height') !== height

        if (column === 'slides') {
          if (heightChanged) pane.style.setProperty('--pane-height', height)
          moveTo(column, active.current, motions.current.slides.destination !== undefined)
          continue
        }
        if (!heightChanged) continue

        const section = sectionFor(pane, active.current)
        const start = pane.scrollTop
        const position = section ? start + sectionTop(pane, section) : 0
        pane.style.setProperty('--pane-height', height)
        if (!section) continue
        const delta = pane.scrollTop + sectionTop(pane, section) - position
        const motion = motions.current[column]
        if (delta || pane.scrollTop !== start) {
          followScroll(pane, motion, (motion.destination ?? start) + delta, motion.destination !== undefined)
        }
      }
    })
    observer.observe(slidePane)
    observer.observe(notePane)
    const running = motions.current
    return () => {
      observer.disconnect()
      window.clearTimeout(slideSettleTimer.current)
      for (const column of columns) stopScroll(running[column])
    }
  }, [moveTo])

  // Applying materials replaces sections, so align the selected page before paint.
  useLayoutEffect(() => {
    for (const pane of [slides.current!, notes.current!]) {
      pane.style.setProperty('--pane-height', paneHeight(pane))
    }
    if (previousDemo.current !== demo || !pages.includes(active.current)) active.current = pages[0] ?? 0
    previousDemo.current = demo
    for (const column of columns) {
      stopScroll(motions.current[column])
      moveTo(column, active.current, false)
    }
  }, [pages, demo, moveTo])

  useLayoutEffect(() => {
    stopScroll(motions.current.notes)
    if (readingNotes) moveTo('notes', active.current, false)
  }, [readingNotes, moveTo])

  const select = useCallback((page: number) => {
    if (!pages.includes(page)) return
    active.current = page
    setSelection({ page, demo })
    for (const column of columns) moveTo(column, page, true)
  }, [pages, demo, moveTo])

  function onScroll(column: Column, event: UIEvent<HTMLElement>) {
    const pane = event.currentTarget
    if (isFollowedScroll(pane, motions.current[column])) return false
    if (column === 'slides') window.clearTimeout(slideSettleTimer.current)
    const next = visiblePage(pane, column)
    if (next && next !== active.current) {
      active.current = next
      setSelection({ page: next, demo })
      moveTo(column === 'slides' ? 'notes' : 'slides', next, true)
    }
    return true
  }

  function settleSlides(event: UIEvent<HTMLElement>) {
    const motion = motions.current.slides
    if (motion.destination !== undefined || isFollowedScroll(event.currentTarget, motion)) return

    // 连续拨动滚轮时，先累积滚动距离，停稳后再居中。
    window.clearTimeout(slideSettleTimer.current)
    slideSettleTimer.current = window.setTimeout(() => moveTo('slides', active.current, true), 160)
  }

  function resizeColumns(resize: () => void) {
    const pane = notes.current!
    const section = sectionFor(pane, active.current)
    const motion = motions.current.notes
    const offset = section && motion.destination === undefined ? -sectionTop(pane, section) / section.offsetHeight : 0
    resize()
    moveTo('slides', active.current, false)
    if (section) {
      followScroll(pane, motion, pane.scrollTop + sectionTop(pane, section) + offset * section.offsetHeight, false)
    }
  }

  function interrupt(column: Column) {
    if (column === 'slides') window.clearTimeout(slideSettleTimer.current)
    stopScroll(motions.current[column])
  }

  return { current, slides, notes, select, onScroll, settleSlides, resizeColumns, interrupt }
}

function paneHeight(pane: HTMLElement) {
  const style = getComputedStyle(pane)
  return `${pane.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)}px`
}
