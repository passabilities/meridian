import { statSync } from 'node:fs'
const source = '/tmp/meridian-backlog-20261004/meridian/1219/semantic-round1/probe-source'
const sessions = process.argv[2]
if (!sessions || (statSync(sessions).mode & 0o777) !== 0o700) throw new Error('expected disposable private sessions directory')
const { acquireMaintenanceGuard } = await import(source + '/src/proxy/session/bookkeeping/guard.ts')
let lease
try {
  lease = acquireMaintenanceGuard(sessions)
  console.log(JSON.stringify({ maintenanceAcquiredAfterProbeProcessExit: true }))
} finally {
  lease?.close()
}
