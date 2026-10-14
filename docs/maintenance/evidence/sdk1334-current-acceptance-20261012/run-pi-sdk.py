import json,os,subprocess,sys
from pathlib import Path
r=Path('/tmp/meridian-sdk1334-live-20261012');arm=sys.argv[1];assert arm in ['source','installed'];assert not (r/(arm+'-report.json')).exists()
w='/Users/rynfar/repos/meridian-sdk-close-acceptance-1334-20261012'
ready=subprocess.run(['bun','/tmp/meridian-scrub-qualified-readiness-20261012.mjs'],capture_output=True,text=True,check=True);facts=json.loads(ready.stdout);(r/(arm+'-readiness.json')).write_text(ready.stdout);assert facts['extraUsageEnabled'] is False and facts['fiveHourUtilization']<100
assert not (r/'grant.json').exists();subprocess.run(['bun',str(r/'stage.mjs')],check=True)
env={k:v for k,v in os.environ.items() if not k.startswith(('MERIDIAN_','CLAUDE_','ANTHROPIC_','PI_','OPENCODE_','NODE_OPTIONS'))}
env.update({'E2E_ALLOW_LIVE_MODEL':'1','E2E_LIVE_PROFILE_FILE':str(r/'grant.json'),'E2E_PI_PACKAGE':'/tmp/meridian-1351-pi-client-20261012/node_modules/@earendil-works/pi-coding-agent','E2E_PLUGIN_PATH':'/tmp/meridian-1351-pi-client-20261012/node_modules/@rynfar/meridian-plugin-pi-scrub/dist/index.js','E2E_SCRUB_VERSION':'0.2.2','E2E_NATIVE_BIN':'/Users/rynfar/.local/bin/claude','E2E_EXPECT':'candidate','E2E_MERIDIAN_ROOT':w if arm=='source' else '/tmp/meridian-sdk1334-current-installed-20261012/node_modules/@rynfar/meridian'})
with (r/(arm+'-console.txt')).open('w') as out:child=subprocess.run(['node',w+'/scripts/e2e-pi-historical-image-dedup.mjs'],cwd=w,env=env,stdout=out,stderr=subprocess.STDOUT)
rows=[json.loads(s) for s in (r/(arm+'-console.txt')).read_text().splitlines() if s.startswith('{')];last=rows[-1];report=json.loads((Path(last['root'])/'report.json').read_text());report['originalExit']=child.returncode;report['sourceCommit']='35784e08';report['acceptanceScope']='Healthy actual Pi/Opus5.5/SDK process cleanup and historical-image replay; not original Linux-x64/OpenCode OAuth hang or natural fault reproduction';(r/(arm+'-report.json')).write_text(json.dumps(report,indent=2)+'\n')
if report.get('joined'):(r/'grant.json').unlink()
print(json.dumps({'arm':arm,'exit':child.returncode,'result':report['result'],'joined':report.get('joined')}),flush=True)
assert child.returncode==0 and report['result']=='PASS' and report.get('joined')
