import { exec, execFile, type ChildProcess } from 'child_process'

interface ProcessOptions {
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  maxBuffer?: number
  // Internal deadlines: callers do not control process shutdown.
  killGraceMs?: number
  joinGraceMs?: number
}

export class AuthStatusProcessFailure extends Error {
  constructor(readonly reason: 'cancelled' | 'timeout' | 'join') {
    super(reason === 'join' ? 'Claude auth-status process cleanup is unconfirmed' : `Claude auth-status check ${reason}`)
  }
}

export interface AuthStatusProcess {
  result: Promise<string>
  /** Resolves only after observed process settlement and both captured pipes close. */
  joined: Promise<void>
  isJoined(): boolean
  cancel(): Promise<void>
}

/**
 * The callback/output promise is not process ownership. Keep exit, close and
 * pipe witnesses independently, and never signal an exited/replaced child.
 * A missing witness rejects bounded cleanup; the live joined promise remains
 * pending so the caller cannot release its single-flight slot prematurely.
 */
export function startAuthStatusProcess(file: string, options: ProcessOptions): AuthStatusProcess {
  return startOwnedClaudeProcess({ file, args: ['auth', 'status'] }, options)
}

/** Internal resolver/auth subprocess leaf; shell lookup preserves Windows where semantics. */
export function startOwnedClaudeProcess(command: { file: string; args: string[] } | { shell: string }, options: ProcessOptions): AuthStatusProcess {
  let child: ChildProcess | undefined
  let ownedPid: number | undefined
  let callbackDone = false
  let callbackError: Error | null = null
  let stdout = ''
  let exitSeen = false
  let exitCode: number | null = null
  let exitSignal: NodeJS.Signals | null = null
  let closeSeen = false
  let spawnFailed = false
  let stdoutClosed = false
  let stderrClosed = false
  let failure: AuthStatusProcessFailure | undefined
  let settled = false
  let stopPromise: Promise<void> | undefined
  let processTimer: ReturnType<typeof setTimeout> | undefined
  let killTimer: ReturnType<typeof setTimeout> | undefined
  let joinTimer: ReturnType<typeof setTimeout> | undefined
  let resolveJoined!: () => void
  let resolveResult!: (value: string) => void
  let rejectResult!: (error: unknown) => void
  const joined = new Promise<void>(resolve => { resolveJoined = resolve })
  const result = new Promise<string>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
  // The owner attaches immediately, but a synchronous spawn failure must
  // still never create an unhandled rejection before that attachment.
  void result.catch(() => undefined)

  const complete = () => {
    if (settled || !callbackDone || !closeSeen || !stdoutClosed || !stderrClosed) return
    if (!exitSeen && !spawnFailed) return
    settled = true
    clearTimeout(processTimer); clearTimeout(killTimer); clearTimeout(joinTimer)
    resolveJoined()
    if (failure) rejectResult(failure)
    // execFile's callback error omits stdout; promisify used to attach it.
    // Keep the captured answer for numeric diagnostics without printing it.
    else if (callbackError) rejectResult(Object.assign(callbackError, { stdout }))
    else if (!exitSeen || exitCode !== 0 || exitSignal !== null) {
      rejectResult(Object.assign(new Error('Claude auth-status process did not exit successfully'), { code: exitCode, signal: exitSignal, stdout }))
    } else resolveResult(stdout)
  }

  const signalOwned = (signal: NodeJS.Signals) => {
    if (!child || exitSeen || closeSeen || !ownedPid || child.pid !== ownedPid) return
    // This is the exact ChildProcess created here, while its exit is still
    // unobserved. Never use a module-global PID or signal another owner.
    try { child.kill(signal) }
    catch { failure ??= new AuthStatusProcessFailure('join') }
  }

  const stop = (reason: 'cancelled' | 'timeout'): Promise<void> => {
    if (settled) return joined
    if (stopPromise) return stopPromise
    failure ??= new AuthStatusProcessFailure(reason)
    clearTimeout(processTimer)
    signalOwned('SIGTERM')
    if (settled) return joined
    killTimer = setTimeout(() => signalOwned('SIGKILL'), options.killGraceMs ?? 1000)
    killTimer.unref?.()
    stopPromise = new Promise<void>((resolve, reject) => {
      joinTimer = setTimeout(() => {
        const error = new AuthStatusProcessFailure('join')
        rejectResult(error)
        reject(error)
      }, (options.killGraceMs ?? 1000) + (options.joinGraceMs ?? 2000))
      joinTimer.unref?.()
      void joined.then(resolve)
    })
    void stopPromise.catch(() => undefined)
    complete()
    return stopPromise
  }

  try {
    const execOptions = {
      encoding: 'utf8' as const, timeout: options.timeoutMs, windowsHide: true,
      ...(options.maxBuffer !== undefined ? { maxBuffer: options.maxBuffer } : {}),
      ...(options.env ? { env: options.env } : {}),
    }
    const callback = (error: Error | null, output: string) => {
      callbackDone = true; callbackError = error; stdout = output
      complete()
    }
    child = 'shell' in command
      ? exec(command.shell, execOptions, callback)
      : execFile(command.file, command.args, execOptions, callback)
    ownedPid = child.pid
    stdoutClosed = child.stdout === null
    stderrClosed = child.stderr === null
    child.stdout?.once('close', () => { stdoutClosed = true; complete() })
    child.stderr?.once('close', () => { stderrClosed = true; complete() })
    child.once('error', () => { spawnFailed = !ownedPid; complete() })
    child.once('exit', (code, signal) => {
      exitSeen = true; exitCode = code; exitSignal = signal; complete()
    })
    child.once('close', () => { closeSeen = true; complete() })
    processTimer = setTimeout(() => { void stop('timeout').catch(() => undefined) }, options.timeoutMs)
    processTimer.unref?.()
    complete()
  } catch (error) {
    // execFile throwing synchronously creates no child to join.
    settled = true; resolveJoined(); rejectResult(error)
  }
  return { result, joined, isJoined: () => settled, cancel: () => stop('cancelled') }
}
