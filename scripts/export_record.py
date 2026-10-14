#!/usr/bin/env python3
"""Export a read-only record of the Paperclip run: API reads, plus three tables read straight from
its database (wake-up requests, review/approval decisions, environment leases), all limited to one company.
The database reads use scripts/pg-query.mjs, which this script copies into the container first.

Usage: export_record.py <paperclip-url> <cookie-file> <company-id> <container> <out.json>

The cookie belongs to the operator account. The output is scrubbed with patterns for tokens, keys,
JWTs, home directories and e-mail addresses, and the script refuses to write if a known secret
pattern survives. Pattern scrubbing reduces risk; it is not a guarantee, so read the file before publishing it.
"""
import json, os, re, subprocess, sys, urllib.request

base, cookie_file, company, container, out = sys.argv[1:6]
cookie = open(cookie_file).read().strip()


def get(path):
    req = urllib.request.Request(base + '/api' + path, headers={'Cookie': cookie})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


HELPER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pg-query.mjs')
subprocess.run(['docker', 'cp', HELPER, f'{container}:/tmp/pg-query.mjs'], check=True)


def db(sql):
    res = subprocess.run(['docker', 'exec', container, 'node', '/tmp/pg-query.mjs', sql, company], capture_output=True, text=True, check=True)
    return json.loads(res.stdout)


health = get('/health')
agents = get(f'/companies/{company}/agents')
issues = sorted(get(f'/companies/{company}/issues'), key=lambda i: i['createdAt'])
runs = sorted(get(f'/companies/{company}/heartbeat-runs'), key=lambda r: r['createdAt'])

KEEP_AGENT_CFG = ('engine', 'model', 'dangerouslySkipPermissions', 'maxTurnsPerRun', 'timeoutSec', 'cwd')
record = {
    'exportedFrom': 'Paperclip API (read-only export, not a live Paperclip interface)',
    'paperclip': {'version': health.get('version'), 'commit': health.get('commit'), 'deploymentMode': health.get('deploymentMode')},
    'company': {k: get(f'/companies/{company}').get(k) for k in ('name', 'description', 'issuePrefix', 'createdAt')},
    'goals': [{k: g.get(k) for k in ('id', 'title', 'description', 'status')} for g in get(f'/companies/{company}/goals')],
    'agents': [{
        'id': a['id'], 'name': a['name'], 'role': a['role'], 'title': a.get('title'), 'adapterType': a['adapterType'],
        'adapterConfig': {k: a.get('adapterConfig', {}).get(k) for k in KEEP_AGENT_CFG},
        'budgetMonthlyCents': a.get('budgetMonthlyCents'), 'spentMonthlyCents': a.get('spentMonthlyCents'),
    } for a in agents],
    'issues': [],
    'runs': [{k: r.get(k) for k in (
        'id', 'agentId', 'status', 'invocationSource', 'triggerDetail', 'errorCode', 'error', 'exitCode', 'signal',
        'createdAt', 'startedAt', 'finishedAt', 'retryOfRunId', 'scheduledRetryAttempt', 'scheduledRetryReason',
        'issueCommentStatus', 'usageJson')} | {'issueId': (r.get('contextSnapshot') or {}).get('issueId')} for r in runs],
    'wakeupRequests': db("select id, agent_id as \"agentId\", source, reason, status, error, run_id as \"runId\", created_at as \"createdAt\" from agent_wakeup_requests where company_id = $1 order by created_at"),
    'executionDecisions': db("select id, issue_id as \"issueId\", stage_type as \"stageType\", actor_agent_id as \"actorAgentId\", actor_user_id as \"actorUserId\", outcome, created_at as \"createdAt\", body from issue_execution_decisions where company_id = $1 order by created_at"),
    'environmentLeases': db("select id, issue_id as \"issueId\", heartbeat_run_id as \"runId\", status, acquired_at as \"acquiredAt\", released_at as \"releasedAt\" from environment_leases where company_id = $1 order by acquired_at"),
}
for i in issues:
    full = get(f"/issues/{i['id']}")
    record['issues'].append({
        **{k: full.get(k) for k in ('id', 'identifier', 'title', 'description', 'status', 'priority', 'createdAt', 'startedAt',
                                     'completedAt', 'assigneeAgentId', 'assigneeUserId', 'createdByUserId', 'responsibleUserId',
                                     'executionPolicy', 'executionState')},
        'comments': [{k: c.get(k) for k in ('id', 'createdAt', 'authorAgentId', 'authorUserId', 'body')}
                     for c in sorted(get(f"/issues/{i['id']}/comments"), key=lambda c: c['createdAt'])],
        'activity': [{k: a.get(k) for k in ('action', 'actorType', 'actorId', 'agentId', 'runId', 'createdAt', 'details')}
                     for a in sorted(get(f"/issues/{i['id']}/activity"), key=lambda a: a['createdAt'])],
    })

text = json.dumps(record, indent=2, default=str)
SCRUB = [
    (r'sk-ant-[A-Za-z0-9_\-]+', '[redacted-key]'),
    (r'gh[opsu]_[A-Za-z0-9]{20,}', '[redacted-token]'),
    (r'pcp_[A-Za-z0-9_]+', '[redacted-token]'),
    (r'eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]+', '[redacted-jwt]'),
    (r'/(Users|home)/[A-Za-z0-9._\-]+', '/[redacted-home]'),
    (r'[A-Za-z0-9._%+\-]+@(?!example\.com|rehearsal\.invalid)[A-Za-z0-9.\-]+\.[A-Za-z]{2,}', '[redacted-email]'),
]
redactions = {}
for pat, rep in SCRUB:
    text, n = re.subn(pat, rep, text)
    if n: redactions[rep] = redactions.get(rep, 0) + n
for pat in (r'sk-ant-', r'CLAUDE_CODE_OAUTH_TOKEN=\S', r'CLOUDFLARE_API_TOKEN=\S', r'BETTER_AUTH_SECRET'):
    if re.search(pat, text):
        sys.exit(f'refusing to write: pattern {pat!r} still present')
data = json.loads(text)
data['redactions'] = redactions
open(out, 'w').write(json.dumps(data, indent=2) + '\n')
print(f'wrote {out}: {len(data["issues"])} issues, {len(data["runs"])} runs, redactions {redactions}')
