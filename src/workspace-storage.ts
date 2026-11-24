export type WorkspacePpt = { id: string; file: File }

export type Workspace = {
  id: string
  name: string
  ppt: WorkspacePpt | null
  notes: string
  openedAt: number
}

const storeName = 'workspaces'

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function writeTransaction(database: IDBDatabase) {
  const transaction = database.transaction(storeName, 'readwrite')
  const done = new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
  })
  return { store: transaction.objectStore(storeName), done }
}

export function openWorkspaceDatabase() {
  const request = indexedDB.open('ppt-study', 1)
  request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: 'id' })
  return requestResult(request)
}

export async function readWorkspaces(database: IDBDatabase) {
  const rows: Workspace[] = await requestResult(database.transaction(storeName).objectStore(storeName).getAll())
  return rows.sort((a, b) => b.openedAt - a.openedAt)
}

export async function addWorkspace(database: IDBDatabase, workspace: Workspace) {
  const { store, done } = writeTransaction(database)
  store.add(workspace)
  await done
}

export async function updateWorkspace(database: IDBDatabase, id: string, changes: Partial<Omit<Workspace, 'id'>>) {
  const { store, done } = writeTransaction(database)
  const request = store.get(id)
  let updated: Workspace | undefined
  request.onsuccess = () => {
    const workspace: Workspace | undefined = request.result
    if (!workspace) return
    updated = { ...workspace, ...changes }
    store.put(updated)
  }
  await done
  if (!updated) throw new Error('工作区已被删除')
  return updated
}

export async function deleteWorkspace(database: IDBDatabase, id: string) {
  const { store, done } = writeTransaction(database)
  store.delete(id)
  await done
}
