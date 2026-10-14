import datetime
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

root = Path('/tmp/meridian-backlog-20261004/meridian/1219/semantic-round1/P4-shutdown-probe')
source = Path('/tmp/meridian-backlog-20261004/meridian/1219/semantic-round1/probe-source')
runtime = Path(tempfile.mkdtemp(prefix='runtime-', dir=root))
runtime.chmod(0o700)
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
record = {'startedAtUTC': started, 'ownedRuntimeDirectory': str(runtime), 'probeTimeoutSeconds': 20}
try:
    process = subprocess.run(['bun', 'run', str(root / 'probe.mjs'), str(runtime)], cwd=source, text=True, capture_output=True, timeout=20)
    (root / 'probe.stdout.log').write_text(process.stdout)
    (root / 'probe.stderr.log').write_text(process.stderr)
    record['probeExitCode'] = process.returncode
    if (runtime / 'result.json').exists():
        result = json.loads((runtime / 'result.json').read_text())
        (root / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        record['probeStatus'] = result['status']
    if process.returncode == 0:
        after = subprocess.run(['bun', 'run', str(root / 'maintenance-after-exit.mjs'), str(runtime / 'sessions')], cwd=source, text=True, capture_output=True, timeout=8)
        (root / 'maintenance-after-exit.stdout.log').write_text(after.stdout)
        (root / 'maintenance-after-exit.stderr.log').write_text(after.stderr)
        record['maintenanceAfterExitCode'] = after.returncode
        record['maintenanceAfterExit'] = json.loads(after.stdout.strip()) if after.returncode == 0 else {'error': after.stderr.strip()}
except subprocess.TimeoutExpired as error:
    record['timedOut'] = True
    record['error'] = str(error)
finally:
    shutil.rmtree(runtime)
    record['ownedRuntimeRemoved'] = not runtime.exists()
    record['finishedAtUTC'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    record['controllerProcessesJoined'] = True
    (root / 'controller.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
