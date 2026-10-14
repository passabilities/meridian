#!/usr/bin/env python3
"""Manual, token-consuming Polytoken concurrency probe; never edits user config.

Requires a running authenticated Meridian, Polytoken 0.8.21+, Python 3.
Outputs include synthetic transcripts; review before sharing. Exit zero requires
both parent processes AND all four child completion events to succeed.
"""
import argparse
import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:3456')
    parser.add_argument('--profile', required=True)
    parser.add_argument('--model', default='claude-haiku-4-5')
    parser.add_argument('--title-first', action='store_true')
    args = parser.parse_args()
    binary = shutil.which('polytoken')
    if not binary:
        parser.error('polytoken must be on PATH')
    root = Path(tempfile.mkdtemp(prefix='meridian-polytoken-live-'))
    print(f'Artifacts: {root}', flush=True)
    config = root / 'config'
    for directory in ('config/facets', 'config/subagents', 'work', 'home/.config/polytoken'):
        (root / directory).mkdir(parents=True, exist_ok=True)
    env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': str(root / 'home'),
           'LANG': 'en_US.UTF-8', 'NO_PROXY': '*', 'no_proxy': '*'}
    for kind in ('config', 'data', 'state', 'cache'):
        path = root / ('xdg-' + kind)
        path.mkdir()
        env['XDG_' + kind.upper() + '_HOME'] = str(path)
    provider = {'kind': {'type': 'custom_anthropic_compatible'}, 'url': args.url,
                'auth': {'type': 'static_key', 'key': os.environ.get('MERIDIAN_API_KEY', 'meridian-local'),
                         'format': 'anthropic_x_api_key'},
                'headers': {'x-meridian-profile': args.profile}}
    settings = {'version': 4, 'providers': {'live': provider}, 'mcp_servers': {},
                'models': {'live-model': {'provider': 'live', 'provider_name': args.model,
                    'class': 'mini', 'variant': 'claude', 'context_window': 200000,
                    'max_output_tokens_per_turn': 2048, 'tool_loading': 'eager'}},
                'modelgroups': {f'polytoken:default_model_{tier}': 'live-model'
                                for tier in ('full', 'mini', 'nano')},
                'exec': {'max_turn_wall_secs': 240, 'provider_stream_idle_timeout_secs': 90}}
    config_file = config / 'config.json'
    config_file.touch(mode=0o600)
    config_file.write_text(json.dumps(settings))
    (root / 'home/.config/polytoken/config.json').write_text(
        json.dumps({'version': 4, 'default_permission_matcher': 'bypass'}))
    (root / 'work/fixture.txt').write_text('MERIDIAN_LIVE_FIXTURE_91\n')
    for index in range(1, 4):
        (root / f'work/fixture-{index}.txt').write_text(f'MERIDIAN_LIVE_FIXTURE_91_{index}\n')
    (config / 'facets/live-probe.md').write_text('''---
name: live-probe
description: Verify live conversation isolation.
polytoken:
  model: live-model
  tools: [file_read, subagent, job_block, job_result, job_status]
  undeferred_tools: [file_read, subagent, job_block, job_result, job_status]
---
Follow the verification prompt exactly. Use only the fixture*.txt files. Report failures honestly.
Finish using exec_structured_output.
''')
    (config / 'subagents/live-worker.md').write_text('''---
name: live-worker
description: Read a synthetic fixture in three tool rounds.
polytoken:
  model: live-model
  inherit_tools: false
  tools: [file_read]
  undeferred_tools: [file_read]
  allow_subagent_spawn: false
  exit_tool_schema:
    type: object
    additionalProperties: false
    required: [summary]
    properties:
      summary:
        type: string
---
Read fixture-1.txt, fixture-2.txt, and fixture-3.txt in that order in three separate assistant tool-call turns, not a batch.
After each result immediately call the next file_read; never end with a text-only readiness message or wait for another user turn. After all three results, call exit_tool with a summary containing the three file contents.
{{ prompt }}
''')
    base = [binary, '--working-dir', str(root / 'work'), '--config-dir', str(config)]
    catalog = subprocess.run(base + ['models', '--format', 'json'], env=env,
                             capture_output=True, text=True, check=True, timeout=30)
    models = json.loads(catalog.stdout)['models']
    if not models or any(m['provider'] != 'live' for m in models):
        raise RuntimeError('isolated provider check failed')

    def run(name):
        prefix = 'First read fixture.txt three times on separate turns. ' if args.title_first else ''
        prompt = (prefix + 'Call the subagent tool exactly twice in total, with count=1 on each call '
                  '(not count=2). Both calls must use subagent_type="live-worker" and model_override="live-model". '
                  f'Name the first {name}-alpha and the second {name}-beta. '
                  'In each child prompt explicitly require one file_read for each of fixture-1.txt, fixture-2.txt, fixture-3.txt in order '
                  'in three separate tool-call rounds without waiting for another user message. Never stop with text-only readiness; after all three results call exit_tool with summary. '
                  'Launch both before waiting, then use job_block or job_result to collect those two existing jobs. '
                  'Never call subagent again, even if a job is pending or failed. '
                  'Finish with exec_structured_output after both existing jobs complete.')
        command = base + ['exec', '--accept-license-terms', '--facets-dir', str(config / 'facets'),
                          '--subagents-dir', str(config / 'subagents'), '--facet', 'live-probe',
                          '--model', 'live-model', '--max-tool-turns', '18', prompt]
        with (root / (name + '.stdout')).open('w') as out, (root / (name + '.stderr')).open('w') as err:
            try:
                code = subprocess.run(command, env=env, stdin=subprocess.DEVNULL,
                                      stdout=out, stderr=err, timeout=300).returncode
            except subprocess.TimeoutExpired:
                code = 124
        return {'run': name, 'exit': code}

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            runs = list(pool.map(run, ['session-a', 'session-b']))
    finally:
        # Do not leave a supplied local proxy API key in the artifact directory.
        provider['auth']['key'] = '<removed after run>'
        config_file.write_text(json.dumps(settings))
    children = []
    for log in (root / 'xdg-data/polytoken/sessions-v1').glob('*/log.jsonl'):
        for line in log.read_text().splitlines():
            message = json.loads(line).get('message', {})
            if message.get('type') == 'subagent_complete':
                children.append({'session': log.parent.name, 'handle': message.get('handle'),
                                 'outcome': message.get('outcome')})
    # Verify actual executed reads, not the model's natural-language claims.
    read_evidence = []
    for log in (root / 'xdg-data/polytoken/sessions-v1').glob('*/*.jsonl'):
        if log.name != 'log.jsonl' and not log.name.startswith('subagent-'):
            continue
        turns = 0
        read_ids = set()
        successful_reads = set()
        for line in log.read_text().splitlines():
            event = json.loads(line)
            body = event.get('public_payload', {}).get('item', {}).get('body', event)
            if body.get('type') == 'tool_result':
                for result in body.get('results', []):
                    if not result.get('is_error') and 'MERIDIAN_LIVE_FIXTURE_91' in json.dumps(result.get('content')):
                        successful_reads.add(result.get('tool_use_id'))
            if body.get('type') not in ('assistant', 'assistant_message'):
                continue
            reads = [b for b in body.get('blocks', [])
                     if b.get('type') == 'tool_use' and b.get('name') == 'file_read']
            if reads:
                turns += 1
                read_ids.update(b['id'] for b in reads)
        read_evidence.append({'session': log.parent.name, 'transcript': log.name,
                              'read_turns': turns, 'successful_reads': len(read_ids & successful_reads)})
    expected_transcripts = 6 if args.title_first else 4
    checked_reads = [r for r in read_evidence if args.title_first or r['transcript'] != 'log.jsonl']
    reads_passed = len(checked_reads) == expected_transcripts and all(
        r['read_turns'] >= 3 and r['successful_reads'] >= 3 for r in checked_reads)
    passed = reads_passed and all(r['exit'] == 0 for r in runs) and len(children) == 4 and all(
        c['outcome'] and c['outcome'].get('kind') == 'success' for c in children)
    result = {'runs': runs, 'children': children, 'passed': passed,
              'read_evidence': read_evidence,
              'note': 'Read evidence is asserted above; server harness must additionally verify SDK mappings.'}
    (root / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
