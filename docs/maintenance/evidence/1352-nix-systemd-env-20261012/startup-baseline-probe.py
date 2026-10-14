import json,subprocess,time
from pathlib import Path
prefix=['orb','-m','meridian-nix-1352']
def run(args,input=None):return subprocess.run(prefix+args,input=input,capture_output=True,text=True)
root='/tmp/meridian-nix-startup-1353-baseline';unit='meridian-startup-1353-baseline.service';unitpath='/run/user/501/systemd/user/'+unit
values={'HOME':root+'/home','MERIDIAN_CONFIG_DIR':root+'/config space','MERIDIAN_SESSION_DIR':root+'/sessions','MERIDIAN_WORKDIR':root+'/project','MERIDIAN_PROFILES':json.dumps([{'id':'owned-profile','type':'api','apiKey':'owned-loopback-fixture','baseUrl':'http://127.0.0.1:1'}]),'MERIDIAN_TELEMETRY_PERSIST':'0','MERIDIAN_CREDENTIALS_READONLY':'1','MERIDIAN_NO_UPDATE_CHECK':'1','MERIDIAN_PORT':'33952','PATH':'/tmp/meridian-1352-node/bin:/run/current-system/sw/bin'}
expr='''let flake=builtins.getFlake "path:/workspace";pkgs=import flake.inputs.nixpkgs {system=builtins.currentSystem;}; c=(flake.inputs.home-manager.lib.homeManagerConfiguration {inherit pkgs;modules=[(import /tmp/meridian-1352-baseline-hm-module.nix {meridian=pkgs.emptyDirectory;}) {home.username="meridian-test";home.homeDirectory="/home/meridian-test";home.stateVersion="25.11";services.meridian={enable=true;environment=builtins.fromJSON '''+json.dumps(json.dumps(values))+''';};}];}).config;in c.systemd.user.services.meridian.Service.Environment'''
ev=run(['nix','--extra-experimental-features','nix-command flakes','eval','--impure','--json','--expr',expr]);assert ev.returncode==0,ev.stderr
assignments=json.loads(ev.stdout)
assert run(['mkdir','-p',root+'/home',root+'/project']).returncode==0
text='[Service]\nType=exec\nRestart=no\n'+''.join('Environment='+v+'\n' for v in assignments)+'ExecStart=/tmp/meridian-1352-node/bin/node /tmp/meridian-1353-startup/node_modules/@rynfar/meridian/dist/cli.js\nStandardOutput=truncate:'+root+'/console.txt\nStandardError=inherit\n'
ctl=['env','XDG_RUNTIME_DIR=/run/user/501','systemctl','--user']
report={'modelCalls':0,'ownedProfile':'owned-profile','packageSource':'76038fb799632c6d3b2fb120f5bdc6234130573b'}
try:
 assert run(['sh','-c','cat > "$1"','sh',unitpath],text).returncode==0
 assert run(ctl+['daemon-reload']).returncode==0
 start=run(ctl+['start',unit]);report['startExit']=start.returncode
 for i in range(25):
  q=run(['/tmp/meridian-1352-node/bin/node','-e',"fetch('http://127.0.0.1:33952/settings/api/routing').then(r=>r.json()).then(r=>console.log(JSON.stringify(r))).catch(()=>process.exit(1))"])
  if q.returncode==0:
   report['routing']=json.loads(q.stdout);break
  state=run(ctl+['show',unit,'--property=ActiveState','--value']).stdout.strip()
  if state in ['failed','inactive']:report['state']=state;break
  time.sleep(0.5)
 report['result']='PASS' if report.get('routing',{}).get('profiles')==['owned-profile'] else 'FAIL'
 report['console']=run(['cat',root+'/console.txt']).stdout
finally:
 report['stopExit']=run(ctl+['stop',unit]).returncode
 report['joined']=run(ctl+['show',unit,'--property=MainPID','--value']).stdout.strip()=='0'
 if report['joined']:
  run(ctl+['reset-failed',unit]);assert run(['rm',unitpath]).returncode==0;assert run(ctl+['daemon-reload']).returncode==0
 Path('/tmp/meridian-1353-startup-baseline-report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
assert report['result']=='FAIL' and report['joined'] and report.get('routing',{}).get('profiles')==['default'] and 'Failed to parse MERIDIAN_PROFILES' in report['console']
