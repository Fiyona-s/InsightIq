#!/usr/bin/env python3
"""Full backup procedure used for local Docker workspace phase baselines.
Refuses active work; pauses only for the copy, always unpauses, never overwrites.
"""
import argparse,datetime,json,pathlib,sqlite3,subprocess,urllib.request

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--container',default='project-api-1');parser.add_argument('--api',default='http://localhost:8000');parser.add_argument('--destination',required=True)
    args=parser.parse_args();folder=pathlib.Path(args.destination).resolve()
    def get(path):return urllib.request.urlopen(args.api+'/api'+path).read()
    datasets=json.loads(get('/datasets?include_archived=true'))
    if any(json.loads(get('/datasets/'+d['id']+'/dependencies'))['delete_blocked'] for d in datasets):raise SystemExit('Active jobs must finish before backup.')
    script="import sqlite3,json;d=sqlite3.connect('file:/data/catalog.sqlite?mode=ro',uri=True);print(json.dumps(dict(audit=d.execute('SELECT * FROM dataset_audit').fetchall(),datasets=d.execute('SELECT id,name FROM datasets').fetchall(),active=d.execute(\"SELECT COUNT(*) FROM analyst_runs WHERE status NOT IN ('succeeded','failed','cancelled','clarification')\").fetchone()[0])))"
    state=json.loads(subprocess.check_output(['docker','exec',args.container,'python','-c',script],text=True))
    if state['active']:raise SystemExit('Active Analyst runs must finish before backup.')
    folder.mkdir(parents=True,exist_ok=False);(folder/'datasets-before.json').write_bytes(get('/datasets?include_archived=true'))
    subprocess.run(['docker','pause',args.container],check=True,stdout=subprocess.DEVNULL)
    try:subprocess.run(['docker','cp',args.container+':/data/.',str(folder/'data')],check=True)
    finally:subprocess.run(['docker','unpause',args.container],check=True,stdout=subprocess.DEVNULL)
    with sqlite3.connect(folder/'data'/'catalog.sqlite') as source,sqlite3.connect(folder/'catalog-consistent.sqlite') as target:source.backup(target)
    (folder/'preexisting-audit.json').write_text(json.dumps(state,indent=2))
    with sqlite3.connect(folder/'catalog-consistent.sqlite') as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise SystemExit('Backup integrity check failed; do not use this backup.')
    print(str(folder))
if __name__=='__main__':main()
