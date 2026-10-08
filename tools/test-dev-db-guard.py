#!/usr/bin/env python3
"""Offline target validation: no database connections or credentials required."""
import importlib.util
import sys
from pathlib import Path
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('guard', Path(__file__).with_name('assert-dev-db.py'))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
cases = [
    ('postgresql://postgres@/quest?host=/tmp/qhq-test', True),
    ('postgresql://postgres@127.0.0.1:5432/quest', True),
    ('postgresql://postgres@[::1]/quest', True),
    ('postgresql://postgres@db.ydrekmghdbpkothhmbut.supabase.co:5432/postgres', True),
    ('postgresql://postgres.ydrekmghdbpkothhmbut@aws-0-us-west-1.pooler.supabase.com:5432/postgres', True),
    ('postgresql://postgres@db.qqvmcsvdxhgjooirznrj.supabase.co/postgres', False),
    ('postgresql://postgres@evil.example/postgres?application_name=ydrekmghdbpkothhmbut', False),
    ('postgresql://postgres@localhost/postgres?hostaddr=1.1.1.1', False),
    ('postgresql://postgres@localhost/postgres?service=production', False),
    ('postgresql://postgres@/quest', False),
    ('postgresql://postgres@db.ydrekmghdbpkothhmbut.supabase.co:6543/postgres', False),
    ('postgresql://postgres@/quest?host=/tmp/a&host=/tmp/b', False),
    ('postgresql://postgres.qqvmcsvdxhgjooirznrj@aws-0-us-west-1.pooler.supabase.com/postgres?application_name=ydrekmghdbpkothhmbut', False),
    ('postgresql://postgres@localhost/postgres?host=evil.example', False),
    ('postgresql://postgres@localhost/postgres?options=-c%20role=postgres', False),
]
for number, (url, expected) in enumerate(cases, 1):
    assert guard.allowed(url) == expected, f'target case {number} failed'
assert not guard.allowed('postgresql://postgres@db.ydrekmghdbpkothhmbut.supabase.co/postgres', local_only=True)
print(f'Database target guard: {len(cases)+1} cases passed (no connections)')
