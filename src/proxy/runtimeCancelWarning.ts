/**
 * What startup says about a runtime that cannot stop a cancelled request.
 *
 * Under Bun (1.3.14), the node:http server @hono/node-server serves with is
 * never told of a client that goes away before the first byte of its
 * response: neither the socket nor the response closes, and the request's
 * signal never aborts. A request cancelled while the model is still thinking
 * (Esc in Claude Code, an orchestrator stopping subagents still starting) then
 * runs on to the end of its turn, on the account's allowance. Under Node it
 * stops within milliseconds (E87). The supervisor runs the build under Node,
 * and the source under Bun only when there is no build.
 */
export function runtimeCancelWarning(versions: Partial<NodeJS.ProcessVersions> = process.versions): string | undefined {
  if (!versions.bun) return undefined
  return `[PROXY] Running under Bun ${versions.bun}: Bun's HTTP server does not report a client that goes away `
    + "before the first byte of a response, so a request cancelled while the model is still thinking runs on "
    + "to the end of its turn, on the account's allowance. Run the built proxy under Node to stop it: "
    + "npm run build && npm run start"
}
