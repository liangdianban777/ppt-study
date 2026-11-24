export type ScrollMotion = {
  frame?: number
  destination?: number
  written?: number
}

export function motionPreference(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
}

export function stopScroll(motion: ScrollMotion) {
  if (motion.frame !== undefined) cancelAnimationFrame(motion.frame)
  motion.frame = undefined
  motion.destination = undefined
}

export function isFollowedScroll(pane: HTMLElement, motion: ScrollMotion) {
  if (motion.written !== undefined && Math.abs(pane.scrollTop - motion.written) < 1) return true
  stopScroll(motion)
  motion.written = undefined
  return false
}

export function followScroll(pane: HTMLElement, motion: ScrollMotion, requestedTop: number, animate = true) {
  const top = Math.min(Math.max(0, requestedTop), pane.scrollHeight - pane.clientHeight)
  if (animate && motion.destination === top) return
  stopScroll(motion)
  const start = pane.scrollTop
  const distance = top - start
  const write = (position: number) => {
    pane.scrollTop = position
    motion.written = pane.scrollTop
  }

  if (!animate || motionPreference() === 'instant' || Math.abs(distance) < 2) {
    write(top)
    return
  }

  const duration = Math.min(410, 170 + Math.sqrt(Math.abs(distance)) * 5)
  const startedAt = performance.now()
  motion.destination = top
  const tick = (time: number) => {
    const progress = Math.max(0, Math.min(1, (time - startedAt) / duration))
    write(start + distance * (1 - (1 - progress) ** 3))
    if (progress < 1) motion.frame = requestAnimationFrame(tick)
    else stopScroll(motion)
  }
  motion.frame = requestAnimationFrame(tick)
}
