// Routine operational stderr shares the proxy's existing process-wide silence
// policy. Diagnostics remain available when an embedding TUI suppresses stderr.
let silent = false

export function setProxyLogSilent(value: boolean): void {
  silent = value
}

export function plog(message: string): void {
  if (!silent) console.error(message)
}
