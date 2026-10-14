import { AsyncLocalStorage } from 'node:async_hooks'
import { AuthStatusProcessFailure, type AuthStatusProcess } from './authStatusProcess'

export interface AuthStatusOwnerState {
  closed: boolean
  refreshes: Set<AuthRefresh>
}
export interface AuthRefresh {
  owners: Set<AuthStatusOwnerState>
  unowned: boolean
  cancelled: boolean
  process?: AuthStatusProcess
  resolver?: AuthStatusProcess
  joined: Promise<void>
}
export const authStatusOwnerContext = new AsyncLocalStorage<AuthStatusOwnerState>()

/** Internal instance ownership; no route, configuration or lifecycle signature changes. */
export function createAuthStatusOwner() {
  const owner: AuthStatusOwnerState = { closed: false, refreshes: new Set() }
  let closing: Promise<void> | undefined
  return {
    run<T>(callback: () => T): T { return authStatusOwnerContext.run(owner, callback) },
    close(): Promise<void> {
      closing ??= (async () => {
        owner.closed = true
        const stops: Promise<void>[] = []
        for (const refresh of owner.refreshes) {
          refresh.owners.delete(owner)
          if (refresh.owners.size > 0 || refresh.unowned) continue
          refresh.cancelled = true
          // Cancellation during executable resolution prevents the spawn.
          // Resolution is bounded separately; missing settlement stays unknown.
          stops.push(refresh.process ? refresh.process.cancel() : refresh.resolver ? refresh.resolver.cancel() : waitForAuthJoin(refresh.joined))
        }
        owner.refreshes.clear()
        const results = await Promise.allSettled(stops)
        if (results.some(result => result.status === "rejected")) {
          throw new AuthStatusProcessFailure("join")
        }
      })()
      return closing
    },
  }
}

function waitForAuthJoin(joined: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    joined,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AuthStatusProcessFailure("join")), 3000)
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}
