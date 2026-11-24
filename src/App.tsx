import { memo, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, ClipboardEvent, KeyboardEvent, MouseEvent, PointerEvent, ReactNode } from 'react'
import { SlidePage } from './slides'
import { loadDeck, useVisibleSlides } from './deck'
import type { Deck } from './deck'
import { examples, parseNotes, prompt, renderMarkdown } from './study-content'
import type { Note } from './study-content'
import { usePageSync } from './use-page-sync'
import { addWorkspace, openWorkspaceDatabase, readWorkspaces, updateWorkspace } from './workspace-storage'
import type { Workspace, WorkspacePpt } from './workspace-storage'

const demoNotes = new Map(examples.map((example, index) => [index + 1, example]))
const split = { initial: 59, min: 30, max: 74, step: 3 }

const icons = {
  copy: 'M16 5a1 1 0 0 0-1-1H6a2 2 0 0 0-2 2v9a1 1 0 0 0 1 1m5-8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z',
  edit: 'M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5m-3-9 3 3M9 15l1-4 8-8a2.1 2.1 0 0 1 3 3l-8 8-4 1Z',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  left: 'm15 6-6 6 6 6',
  right: 'm9 6 6 6-6 6',
  down: 'm6 9 6 6 6-6',
  close: 'm6 6 12 12M18 6 6 18',
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12 4 4L19 6',
  toolbar: 'M4 6h16M4 11h16M4 16h10',
}

function Icon({ name }: { name: keyof typeof icons }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icons[name]} /></svg>
}

function ThemeSelect() {
  const root = document.documentElement

  return (
    <select className="theme-select" aria-label="界面主题" title="界面主题" defaultValue={root.dataset.theme ?? 'system'} onChange={event => {
      const theme = event.currentTarget.value
      root.dataset.theme = theme
      try {
        localStorage.setItem('ppt-study:theme', theme)
      } catch (error) {
        console.warn('无法保存主题偏好', error)
      }
    }}>
      <option value="system">跟随系统</option>
      <option value="light">浅色</option>
      <option value="dark">深色</option>
    </select>
  )
}

export default function App() {
  const [library, setLibrary] = useState<{ database: IDBDatabase; workspaces: Workspace[] } | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let disposed = false
    let database: IDBDatabase | undefined
    async function open() {
      try {
        database = await openWorkspaceDatabase()
        if (disposed) return database.close()
        const workspaces = await readWorkspaces(database)
        if (!disposed) setLibrary({ database, workspaces })
      } catch (problem) {
        if (!disposed) setError(true)
        console.warn('工作区读取失败', problem)
      }
    }
    void open()
    return () => {
      disposed = true
      database?.close()
    }
  }, [])

  if (library) return <WorkspaceApp database={library.database} initial={library.workspaces} />
  return <main className="startup" aria-live="polite">
    <h1>期末 PPT 复习</h1>
    {error ? <><p>无法读取工作区。请检查浏览器的站点存储设置后重试。</p><button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>重新加载</button></> : <p>正在读取工作区…</p>}
  </main>
}

type DeckPreview = { pptId: string; deck: Deck | null; error: string }
type WorkspaceOperation = 'import' | 'save' | 'switch'

function disposeDeck(deck: Deck | null | undefined) {
  if (deck?.format === 'pdf') void deck.destroy().catch(error => console.warn('释放 PDF 课件失败', error))
}

function WorkspaceApp({ database, initial }: { database: IDBDatabase; initial: Workspace[] }) {
  const [workspaces, setWorkspaces] = useState(initial)
  const [viewKey, setViewKey] = useState(initial[0]?.id ?? 'new')
  const [preview, setPreview] = useState<DeckPreview | null>(null)
  const [creating, setCreating] = useState(false)
  const [showExample, setShowExample] = useState(false)
  const [busy, setBusy] = useState<WorkspaceOperation | null>(null)
  const [saveError, setSaveError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [switchError, setSwitchError] = useState('')
  const picker = useRef<HTMLInputElement>(null)
  const workspaceTrigger = useRef<HTMLButtonElement>(null)
  const active = workspaces[0]
  const ppt = active?.ppt
  const currentPreview = preview?.pptId === ppt?.id ? preview : null
  const deck = currentPreview?.deck ?? null
  const restoring = Boolean(ppt && !currentPreview)
  const demo = !active && showExample
  const name = active?.name ?? (demo ? '示例课件' : '期末 PPT 复习')
  const rawNotes = active?.notes ?? ''
  const notes = useMemo(() => demo ? demoNotes : rawNotes ? parseNotes(rawNotes) : undefined, [demo, rawNotes])
  const { slideCount, pages } = useMemo(() => {
    const slideCount = deck?.pageCount ?? (demo ? examples.length : 0)
    const pages = slideCount
      ? Array.from({ length: slideCount }, (_, index) => index + 1)
      : [...(notes?.keys() ?? [])].sort((a, b) => a - b)
    return { slideCount, pages }
  }, [deck, demo, notes])

  const importing = busy === 'import'
  useEffect(() => {
    if (!ppt || currentPreview || importing) return
    let disposed = false
    void loadDeck(ppt.file).then(deck => {
      if (disposed) disposeDeck(deck)
      else setPreview({ pptId: ppt.id, deck, error: '' })
    }, problem => {
      if (disposed) return
      setPreview({ pptId: ppt.id, deck: null, error: '无法读取已保存的课件，请重新导入。' })
      console.warn('课件读取失败', problem)
    })
    return () => { disposed = true }
  }, [ppt, currentPreview, importing])

  useEffect(() => () => disposeDeck(preview?.deck), [preview])

  function focusWorkspaceTrigger() {
    requestAnimationFrame(() => workspaceTrigger.current?.focus({ preventScroll: true }))
  }

  function showCreate(next: boolean) {
    setSaveError('')
    setCreating(next)
    if (!next) focusWorkspaceTrigger()
  }

  async function run(action: () => Promise<void>, message: string, operation: WorkspaceOperation = 'save') {
    if (busy) return false
    const reportError = { import: setLoadError, save: setSaveError, switch: setSwitchError }[operation]
    setBusy(operation)
    reportError('')
    try {
      await action()
      return true
    } catch (problem) {
      reportError(message)
      console.warn(message, problem)
      return false
    } finally {
      setBusy(null)
    }
  }

  function openedAt() {
    return Math.max(Date.now(), (active?.openedAt ?? 0) + 1)
  }

  function activate(workspace: Workspace, preserveView = false) {
    setWorkspaces(rows => [workspace, ...rows.filter(row => row.id !== workspace.id)])
    if (!preserveView) setViewKey(workspace.id)
    setShowExample(false)
    setPreview(null)
    setLoadError('')
  }

  async function create(name: string, ppt: WorkspacePpt | null = null, notes = '') {
    const workspace = { id: crypto.randomUUID(), name, ppt, notes, openedAt: openedAt() }
    await addWorkspace(database, workspace)
    activate(workspace, Boolean(ppt || notes))
  }

  async function update(id: string, changes: Partial<Omit<Workspace, 'id'>>) {
    const workspace = await updateWorkspace(database, id, changes)
    setWorkspaces(rows => rows.map(row => row.id === id ? { ...workspace, ppt: row.ppt?.id === workspace.ppt?.id ? row.ppt : workspace.ppt } : row))
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const field = event.currentTarget
    const file = field.files?.[0]
    field.value = ''
    if (!file) return
    setSaveError('')

    const isPdf = /\.pdf$/i.test(file.name)
    if (!isPdf && !/\.pptx$/i.test(file.name)) {
      setLoadError('请选择 .pptx 或 .pdf 文件。旧版 .ppt 可以在 PowerPoint 中另存为 .pptx。')
      return
    }
    setLoadError('')
    await run(async () => {
      let imported: Deck
      try {
        imported = await loadDeck(file)
      } catch (problem) {
        setLoadError(isPdf
          ? '无法读取这份 PDF。请确认文件能正常打开，并导入无需密码的版本。'
          : '无法读取这份 PPTX。请确认文件能在 PowerPoint 中打开，或重新另存为 .pptx 后导入。')
        console.warn('课件导入失败', problem)
        return
      }

      try {
        const ppt = { id: crypto.randomUUID(), file }
        if (active) await update(active.id, { ppt })
        else await create(imported.name || file.name, ppt)
        setPreview({ pptId: ppt.id, deck: imported, error: '' })
      } catch (problem) {
        disposeDeck(imported)
        throw problem
      }
    }, '无法保存课件。请检查浏览器的存储空间后重试。', 'import')
  }

  function saveNotes(raw: string) {
    return run(async () => {
      if (active) await update(active.id, { notes: raw })
      else await create('未命名工作区', null, raw)
    }, '无法保存讲解，请重试。')
  }

  function switchWorkspace(id: string) {
    void run(async () => {
      activate(await updateWorkspace(database, id, { openedAt: openedAt() }))
      focusWorkspaceTrigger()
    }, '无法切换，请重试。', 'switch')
  }

  return (
    <main className="study-app">
      <input ref={picker} type="file" accept=".pptx,.pdf" hidden onChange={importFile} />
      <StudyWorkspace
        key={demo ? 'demo' : viewKey}
        workspaceTitle={<>
          <h1><button ref={workspaceTrigger} type="button" className="workspace-trigger" title={name} popoverTarget="workspace-switcher" disabled={Boolean(busy)}>
            <span>{name}</span><Icon name="down" />
          </button></h1>
          <div id="workspace-switcher" className="workspace-popover" popover="auto" onBeforeToggle={event => {
            if (event.newState === 'open') setSwitchError('')
          }}>
            {workspaces.length ? <ul className="workspace-list">
              {workspaces.map((workspace, index) => (
                <li key={workspace.id}>
                  <button type="button" className="workspace-option" title={workspace.name} disabled={Boolean(busy)}
                    aria-current={index === 0 ? 'true' : undefined}
                    popoverTarget={index === 0 ? 'workspace-switcher' : undefined} popoverTargetAction="hide"
                    onClick={index === 0 ? undefined : () => switchWorkspace(workspace.id)}>
                    <span>{workspace.name}</span>{index === 0 ? <Icon name="check" /> : null}
                  </button>
                </li>
              ))}
            </ul> : <button type="button" className="workspace-option" disabled={Boolean(busy)} onClick={() => {
              setShowExample(!demo)
              focusWorkspaceTrigger()
            }}>{demo ? '期末 PPT 复习' : '示例课件'}</button>}
            <div className="workspace-popover-footer">
              <button type="button" className="workspace-option workspace-new" popoverTarget="workspace-switcher" popoverTargetAction="hide" disabled={Boolean(busy)} onClick={() => showCreate(true)}><Icon name="plus" />新建</button>
            </div>
            {switchError ? <p className="workspace-switch-error" role="alert">{switchError}</p> : null}
          </div>
        </>}
        deck={deck} fileName={ppt?.file.name} notes={notes} rawNotes={rawNotes} pages={pages} slideCount={slideCount}
        demo={demo} restoring={restoring} importing={importing} busy={Boolean(busy)}
        loadError={loadError || currentPreview?.error || ''} saveError={creating ? '' : saveError}
        onChooseFile={() => picker.current?.click()} onSaveNotes={saveNotes} clearSaveError={() => setSaveError('')}
      />
      {creating ? (
        <CreateWorkspaceDialog busy={Boolean(busy)} error={saveError} onClose={() => showCreate(false)}
          onSubmit={name => void run(async () => {
            await create(name)
            showCreate(false)
          }, '无法创建，请重试。')} />
      ) : null}
    </main>
  )
}

function StudyWorkspace({
  workspaceTitle,
  deck, fileName, notes, rawNotes, pages, slideCount, demo, restoring, importing, busy, loadError, saveError,
  onChooseFile, onSaveNotes, clearSaveError,
}: {
  workspaceTitle: ReactNode
  deck: Deck | null
  fileName?: string
  notes: ReadonlyMap<number, Note> | undefined
  rawNotes: string
  pages: number[]
  slideCount: number
  demo: boolean
  restoring: boolean
  importing: boolean
  busy: boolean
  loadError: string
  saveError: string
  onChooseFile: () => void
  onSaveNotes: (raw: string) => Promise<boolean>
  clearSaveError: () => void
}) {
  const layout = useRef<HTMLDivElement>(null)
  const separator = useRef<HTMLDivElement>(null)
  const share = useRef(split.initial)
  const dragOffset = useRef(0)
  const [editing, setEditing] = useState(false)
  const [pagingWithArrows, setPagingWithArrows] = useState(false)
  const [toolbarVisibility, setToolbarVisibility] = useState<'shown' | 'hidden' | 'hovered'>('shown')
  const toolbarHidden = toolbarVisibility === 'hidden'
  const toolbar = useRef<HTMLElement>(null)
  const paneScroll = useRef({ slides: { top: 0, maxTop: 0 }, notes: { top: 0, maxTop: 0 } })
  const editButton = useRef<HTMLButtonElement>(null)
  const reading = Boolean(notes && !editing)

  useLayoutEffect(() => {
    const header = toolbar.current!
    const panes = layout.current!
    const updateInset = () => panes.style.setProperty('--toolbar-height', `${header.offsetHeight}px`)
    updateInset()
    const observer = new ResizeObserver(updateInset)
    observer.observe(header)
    return () => observer.disconnect()
  }, [])

  const sync = usePageSync(pages, demo, reading)
  const { slides: slidesPane, notes: notesPane, current, select } = sync
  const visible = useVisibleSlides(slidesPane, deck)
  const matchStatus = useMemo(() => notes ? describeMatch(notes, slideCount) : '', [notes, slideCount])

  const turnPageWithArrow = useEffectEvent((event: globalThis.KeyboardEvent) => {
    const previous = event.key === 'ArrowLeft' || event.key === 'ArrowUp'
    const next = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    if (!previous && !next) {
      if (pagingWithArrows) setPagingWithArrows(false)
      return
    }
    if (editing || !pages.length || event.defaultPrevented || event.isComposing) return
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (event.target instanceof Element && event.target.closest('input, select, textarea, dialog, .workspace-current')) return

    const step = previous ? -1 : 1
    const page = pages[pages.indexOf(current) + step]
    event.preventDefault()
    setPagingWithArrows(true)
    if (page !== undefined) select(page)
  })

  useEffect(() => {
    window.addEventListener('keydown', turnPageWithArrow)
    return () => window.removeEventListener('keydown', turnPageWithArrow)
  }, [])

  function closeEditor() {
    setEditing(false)
    clearSaveError()
    requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }))
  }

  function paneHandlers(column: 'slides' | 'notes') {
    const canToggleToolbar = !editing && (column === 'notes' ? reading : slideCount > 0)
    return {
      onScroll: (event: React.UIEvent<HTMLElement>) => {
        const pane = event.currentTarget
        const top = pane.scrollTop
        const maxTop = pane.scrollHeight - pane.clientHeight
        const previous = paneScroll.current[column]
        paneScroll.current[column] = { top, maxTop }
        if (!sync.onScroll(column, event) || !canToggleToolbar) return
        // 阅读区变高时，浏览器可能将滚动位置限制在新的底部。
        if (top < previous.top && maxTop < previous.maxTop && Math.abs(top - maxTop) < 1) return
        if (top <= 0 || top < previous.top) setToolbarVisibility('shown')
        else if (top > Math.max(24, previous.top) && !toolbar.current?.matches(':is(:focus-visible, :has(:focus-visible, :popover-open))')) setToolbarVisibility('hidden')
      },
      onWheel: (event: React.WheelEvent<HTMLElement>) => {
        if (event.ctrlKey || !event.deltaY) return
        sync.interrupt(column)
        if (event.deltaY < 0 && canToggleToolbar) setToolbarVisibility('shown')
      },
      onPointerDownCapture: () => sync.interrupt(column),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (['PageDown', 'PageUp', 'Home', 'End', ' '].includes(event.key)) sync.interrupt(column)
      },
    }
  }

  function setSplit(percent: number) {
    const next = Math.min(split.max, Math.max(split.min, percent))
    if (next === share.current) return
    share.current = next
    sync.resizeColumns(() => {
      layout.current!.style.setProperty('--ppt-width', `${next}%`)
      separator.current!.setAttribute('aria-valuenow', String(Math.round(next)))
    })
  }

  function dragStart(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    const handle = event.currentTarget
    dragOffset.current = event.clientX - handle.getBoundingClientRect().left
    handle.setPointerCapture(event.pointerId)
    layout.current!.classList.add('resizing')
  }

  function dragMove(event: PointerEvent<HTMLDivElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const bounds = layout.current!.getBoundingClientRect()
    setSplit((event.clientX - bounds.left - dragOffset.current) * 100 / bounds.width)
  }

  function splitKey(event: KeyboardEvent<HTMLDivElement>) {
    const positions = new Map([
      ['ArrowLeft', share.current - split.step], ['ArrowRight', share.current + split.step], ['Home', split.min], ['End', split.max],
    ])
    const next = positions.get(event.key)
    if (next === undefined) return
    event.preventDefault()
    setSplit(next)
  }

  function updateToolbarHover(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'mouse') return
    const top = event.currentTarget.getBoundingClientRect().top
    if (event.clientY >= top + toolbar.current!.offsetHeight) {
      if (toolbarVisibility === 'hovered') setToolbarVisibility('hidden')
    } else if (toolbarHidden && !event.buttons) {
      setToolbarVisibility('hovered')
    }
  }

  return (
    <section className="workspace" aria-label="同步复习" data-arrow-paging={pagingWithArrows || undefined}
      onFocus={() => { if (pagingWithArrows) setPagingWithArrows(false) }}
      onPointerMove={toolbarVisibility === 'shown' ? undefined : updateToolbarHover}
      onPointerLeave={toolbarVisibility === 'hovered' ? event => {
        if (event.pointerType === 'mouse') setToolbarVisibility('hidden')
      } : undefined}>
      <div className={`toolbar-slot${toolbarHidden ? ' toolbar-collapsed' : ''}`}>
        <header ref={toolbar} className="workspace-toolbar" id="workspace-toolbar" tabIndex={-1} inert={toolbarHidden} onFocus={event => {
          if (toolbarVisibility === 'hovered' && event.target.matches(':focus-visible')) setToolbarVisibility('shown')
        }}>
          <div className="workspace-current" onClick={() => setToolbarVisibility('shown')}>{workspaceTitle}</div>
          {pages.length > 0 ? <PageNav pages={pages} current={current} onSelect={select} /> : null}
          <div className="toolbar-actions">
            {fileName ? <button type="button" className="btn btn-link" disabled={busy} onClick={onChooseFile} title={fileName}>{importing ? '导入中…' : '更换课件'}</button> : null}
            {reading && !demo ? <button ref={editButton} type="button" className="btn btn-link" disabled={busy} onClick={() => setEditing(true)}><Icon name="edit" />编辑讲解</button> : null}
            <ThemeSelect />
          </div>
          {matchStatus ? <p className="match-status status-text" role="status">{matchStatus}</p> : null}
        </header>
      </div>
      <div ref={layout} className={reading ? 'panes' : 'panes preparing-notes'}>
        <section className="study-panel" aria-label="课程课件">
          <div ref={slidesPane} className="scroll-pane slides-pane" id="slides-pane" tabIndex={slideCount ? 0 : undefined} onScrollEnd={sync.settleSlides} {...paneHandlers('slides')}>
            {slideCount ? pages.map(page => (
              <SlidePage key={page} page={page} active={page === current} title={notes?.get(page)?.title} example={demo ? examples[page - 1] : undefined} deck={deck} preview={visible.has(page) || page === current} onNavigate={select} />
            )) : <div className="empty-pane">
              <div className="upload-card">
                <span className="empty-icon"><Icon name="upload" /></span>
                <h3>上传课程课件</h3>
                <p>支持 .pptx 和 .pdf 文件</p>
                {importing || restoring ? <p className="upload-status" role="status">{importing ? '正在导入课件…' : '正在读取课件…'}</p> :
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={onChooseFile}>选择文件</button>}
              </div>
            </div>}
          </div>
          {loadError ? <p className="load-error" role="alert">{loadError}</p> : null}
        </section>
        <div ref={separator} className="splitter" tabIndex={0} role="separator" aria-label="调整 PPT 和讲解宽度" aria-orientation="vertical" aria-controls="slides-pane" aria-valuemin={split.min} aria-valuemax={split.max} aria-valuenow={split.initial} title="拖拽调整两侧宽度" onPointerDown={dragStart} onPointerMove={dragMove} onLostPointerCapture={() => layout.current!.classList.remove('resizing')} onKeyDown={splitKey} />
        <section className="study-panel" aria-label="AI 讲解">
          <div ref={notesPane} className="scroll-pane notes-pane" id="notes-pane" tabIndex={reading ? 0 : undefined} {...paneHandlers('notes')}>
            {reading ? pages.map(page => <NotePage key={page} page={page} note={notes?.get(page)} active={page === current} />) :
              <NotesEditor initial={rawNotes} busy={busy} saveError={saveError} onCancel={editing ? closeEditor : undefined} onSave={async raw => {
                if (await onSaveNotes(raw)) closeEditor()
              }} />}
          </div>
        </section>
      </div>
      {toolbarHidden ? <button type="button" className="btn reveal-toolbar" aria-controls="workspace-toolbar" onClick={event => {
        setToolbarVisibility('shown')
        if (event.detail === 0) requestAnimationFrame(() => toolbar.current?.focus({ preventScroll: true }))
      }}><Icon name="toolbar" />显示工具栏</button> : null}
    </section>
  )
}

function describeMatch(notes: ReadonlyMap<number, Note>, slideCount: number) {
  if (!slideCount) return ''
  let matched = 0
  for (const page of notes.keys()) if (page <= slideCount) matched++
  if (matched === slideCount && matched === notes.size) return ''
  const parts = [`已匹配 ${matched}/${slideCount} 页`]
  if (matched < slideCount) parts.push(`${slideCount - matched} 页缺少讲解`)
  if (matched < notes.size) parts.push(`${notes.size - matched} 页讲解超出课件页码`)
  return parts.join(' · ')
}

const NotePage = memo(function NotePage({ page, note, active }: { page: number; note?: Note; active: boolean }) {
  const html = useMemo(() => note ? renderMarkdown(note.body, page) : '', [note, page])
  return (
    <section data-page={page} className={`page-section${active ? ' active' : ''}`}>
      <article className={note ? 'note' : 'note note-missing'}>
        <span className="page-chip">第 {page} 页</span>
        <h4>{note?.title ?? '这一页还没有讲解'}</h4>
        {note ? <div className="note-body" dangerouslySetInnerHTML={{ __html: html }} /> : null}
      </article>
    </section>
  )
})

function PageNav({ pages, current, onSelect }: { pages: number[]; current: number; onSelect: (page: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null)
  const index = pages.indexOf(current)

  function clearPointerFocus(event: MouseEvent<HTMLButtonElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  return (
    <nav className="page-nav" aria-label="翻页">
      <button type="button" aria-label="上一页" aria-keyshortcuts="ArrowLeft ArrowUp" title="上一页" disabled={index <= 0}
        onMouseDown={clearPointerFocus} onClick={() => onSelect(pages[index - 1])}><Icon name="left" /></button>
      <label className="page-jump"><span className="sr-only">跳转页码</span><input id="page-current" type="number" min={pages[0] ?? 1} max={pages.at(-1) ?? 1} inputMode="numeric" autoComplete="off" value={draft ?? (current || '')} disabled={!pages.length} onChange={event => setDraft(event.target.value)} onBlur={() => {
        if (draft !== null) onSelect(Number(draft))
        setDraft(null)
      }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }} /></label>
      <span className="page-total">/ {pages.at(-1) ?? 0}</span>
      <button type="button" aria-label="下一页" aria-keyshortcuts="ArrowRight ArrowDown" title="下一页" disabled={index < 0 || index === pages.length - 1}
        onMouseDown={clearPointerFocus} onClick={() => onSelect(pages[index + 1])}><Icon name="right" /></button>
    </nav>
  )
}

function CreateWorkspaceDialog({ error, busy, onClose, onSubmit }: {
  error: string
  busy: boolean
  onClose: () => void
  onSubmit: (name: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState('')
  const trimmedName = name.trim()

  useLayoutEffect(() => {
    dialog.current!.showModal()
    nameInput.current!.focus()
  }, [])

  return (
    <dialog ref={dialog} aria-labelledby="dialog-title" onClose={onClose} onCancel={event => { if (busy) event.preventDefault() }}>
      <div className="dialog-head"><h2 id="dialog-title">新建</h2><button type="button" className="icon-btn" aria-label="关闭" disabled={busy} onClick={onClose}><Icon name="close" /></button></div>
      <form className="workspace-name-form" onSubmit={event => {
        event.preventDefault()
        if (trimmedName && !busy) onSubmit(trimmedName)
      }}>
        <label htmlFor="workspace-name">名称</label>
        <input ref={nameInput} id="workspace-name" autoComplete="off" required maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} />
        <div className="dialog-foot">
          <span className="dialog-error" role="alert">{error}</span>
          <button type="submit" className="btn btn-primary" disabled={busy || !trimmedName}>创建</button>
        </div>
      </form>
    </dialog>
  )
}

function CopyPromptButton() {
  const [status, setStatus] = useState<'copied' | 'failed' | null>(null)
  const timeout = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timeout.current), [])

  async function copy(button: HTMLButtonElement) {
    let copied = false
    try {
      await navigator.clipboard.writeText(prompt)
      copied = true
    } catch {
      const field = document.createElement('textarea')
      field.className = 'sr-only'
      field.style.position = 'fixed'
      field.readOnly = true
      field.value = prompt
      document.body.append(field)
      field.select()
      try {
        copied = document.execCommand('copy')
      } catch (problem) {
        console.warn('复制提示词失败', problem)
      } finally {
        field.remove()
        button.focus({ preventScroll: true })
      }
    }
    setStatus(copied ? 'copied' : 'failed')
    window.clearTimeout(timeout.current)
    timeout.current = window.setTimeout(() => setStatus(null), 3000)
  }

  return (
    <div className="copy-prompt">
      <button type="button" className="btn btn-link" onClick={event => void copy(event.currentTarget)}><Icon name="copy" />复制提示词</button>
      <div role="status" className="copy-feedback">
        {status ? <span className={status === 'failed' ? 'copy-bubble copy-failed' : 'copy-bubble'}>
          {status === 'copied' ? <><Icon name="check" />提示词已复制</> : '复制失败，请检查浏览器的剪贴板权限后重试'}
        </span> : null}
      </div>
    </div>
  )
}

function NotesEditor({ initial, busy, saveError, onCancel, onSave }: {
  initial: string
  busy: boolean
  saveError: string
  onCancel?: () => void
  onSave: (raw: string) => Promise<void>
}) {
  const editor = useRef<HTMLTextAreaElement>(null)
  const [error, setError] = useState('')
  const message = error || saveError

  function apply(raw: string) {
    try {
      parseNotes(raw)
      setError('')
      void onSave(raw)
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : '无法读取讲解。')
      editor.current!.focus()
    }
  }

  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    if (initial || event.currentTarget.value.trim()) return
    const raw = event.clipboardData.getData('text/plain')
    if (!raw.trim()) return
    event.preventDefault()
    event.currentTarget.value = raw
    apply(raw)
  }

  return (
    <form className={onCancel ? 'notes-editor' : 'notes-editor notes-editor-empty'} onSubmit={event => {
      event.preventDefault()
      apply(editor.current!.value)
    }}>
      <div className="editor-heading">
        {onCancel ? null : <span className="empty-icon"><Icon name="edit" /></span>}
        <label htmlFor="notes-editor">{onCancel ? '讲解原文' : '粘贴 AI 讲解'}</label>
        <p id="editor-hint">{onCancel ? '保留每页的标题格式，比如「## 第 1 页｜页面标题」。' : '把提示词和课件发给 AI，再将生成的 Markdown 粘贴到下方。'}</p>
      </div>
      <textarea ref={editor} id="notes-editor" autoFocus={Boolean(onCancel)} spellCheck={false} aria-describedby={message ? 'editor-hint editor-error' : 'editor-hint'} aria-invalid={Boolean(message)} rows={5} required defaultValue={initial} readOnly={busy}
        placeholder={'## 第 1 页｜页面标题\n\n在这里粘贴 Markdown 讲解'} onPaste={paste} onChange={() => { if (error) setError('') }} />
      {message ? <p id="editor-error" className="editor-error" role="alert">{message}</p> : null}
      <div className="editor-actions">
        <CopyPromptButton />
        <div className="workspace-actions">
          {onCancel ? <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>取消</button> : null}
          <button type="submit" className="btn btn-primary" disabled={busy}>{onCancel ? '保存修改' : '保存并阅读'}</button>
        </div>
      </div>
    </form>
  )
}
