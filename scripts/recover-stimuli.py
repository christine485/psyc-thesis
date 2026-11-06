#!/usr/bin/env python3
"""Recover exact original stimuli from the deployed SVG wrappers; safely resumable."""
import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
from pathlib import Path
import re
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
manifest = json.loads((ROOT / 'docs/modules/stimuli.mjs').read_text().split('=', 1)[1].strip().rstrip(';'))

def validate(data, item):
    if data[:8] != b'\x89PNG\r\n\x1a\n' or struct.unpack('>II', data[16:24]) != (1024, 1024):
        raise ValueError('Invalid PNG signature or dimensions: ' + item['file'])
    if hashlib.sha256(data).hexdigest() != item['sha256']:
        raise ValueError('SHA-256 mismatch: ' + item['file'])

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='https://cloud-flow-emotion-study.christine040805.chatgpt.site/experiment/stimuli')
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--report', default='research/stimuli-recovery-verification.json')
    args = parser.parse_args()
    folder = ROOT / 'docs/stimuli'
    folder.mkdir(parents=True, exist_ok=True)
    def recover(item):
        target = folder / item['file']
        if target.exists():
            validate(target.read_bytes(), item)
            return {'file': item['file'], 'sha256': item['sha256'], 'dimensions': [1024, 1024], 'status': 'verified'}
        if args.verify_only:
            raise FileNotFoundError(str(target))
        url = args.source.rstrip('/') + '/' + item['file'].replace('.png', '.svg')
        result = subprocess.run(['curl', '-fsSL', '--connect-timeout', '15', '--max-time', '50', '--retry', '2', '--retry-delay', '1', '--retry-max-time', '120', url], capture_output=True, check=True)
        match = re.search(rb'data:image/png;base64,([^"\s]+)', result.stdout)
        if not match:
            raise ValueError('No embedded PNG: ' + item['file'])
        data = base64.b64decode(match.group(1), validate=True)
        validate(data, item)
        with tempfile.NamedTemporaryFile(dir=folder, suffix='.tmp', delete=False) as temporary:
            temporary.write(data)
            temp_path = Path(temporary.name)
        temp_path.replace(target)
        return {'file': item['file'], 'sha256': item['sha256'], 'dimensions': [1024, 1024], 'status': 'verified'}
    records, failures = [], []
    with ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as pool:
        pending = {pool.submit(recover, item): item for item in manifest}
        for future in as_completed(pending):
            item = pending[future]
            try:
                records.append(future.result())
                if len(records) % 25 == 0 or len(records) == len(manifest):
                    print(f'Verified {len(records)}/{len(manifest)} stimuli', flush=True)
            except Exception as error:
                failures.append({'file': item['file'], 'error': str(error)})
                print('FAILED ' + item['file'] + ': ' + str(error), flush=True)
    report = {'source': args.source, 'expectedCount': len(manifest), 'verifiedCount': len(records), 'allHashesMatch': len(records) == len(manifest) and not failures, 'dimensions': [1024, 1024], 'files': sorted(records, key=lambda item: item['file']), 'failures': failures}
    path = ROOT / args.report
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in report.items() if key != 'files'}), flush=True)
    if failures:
        raise SystemExit(1)

if __name__ == '__main__':
    main()
