import { AsyncLocalStorage } from 'node:async_hooks'

// Подмена рабочей папки на время одного запроса модели: участник, работающий
// в своей копии проекта, видит через все инструменты только эту копию.

interface Scope {
  root: string
  /** Это отдельная копия проекта, а не оригинал */
  sandbox: boolean
}

const storage = new AsyncLocalStorage<Scope>()

export function runInWorkspace<T>(scope: Scope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn)
}

export function currentScope(): Scope | undefined {
  return storage.getStore()
}
