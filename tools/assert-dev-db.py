#!/usr/bin/env python3
"""Fail closed before libpq connects. Never print a connection string or password."""
import os
import sys
from urllib.parse import urlsplit, parse_qsl, unquote


def allowed(url, local_only=False):
    if 'qqvmcsvdxhgjooirznrj' in unquote(url):
        return False
    try:
        u = urlsplit(url)
        pairs = parse_qsl(u.query, keep_blank_values=True)
        q = dict(pairs)
        if u.scheme not in ('postgres', 'postgresql') or u.fragment:
            return False
        if len(q) != len(pairs) or set(q) - {'host', 'sslmode', 'connect_timeout', 'application_name'}:
            return False
        host = unquote(u.hostname or '')
        if 'host' in q:
            if host or not q['host'].startswith('/') or ',' in q['host']:
                return False
            host = q['host']
        if not host:
            return False  # no ambient PGHOST / service fallback
        if host.startswith('/') or host in ('localhost', '127.0.0.1', '::1'):
            return True
        if local_only or u.port not in (None, 5432):
            return False
        ref = 'ydrekmghdbpkothhmbut'
        return host == f'db.{ref}.supabase.co' or (
            host.endswith('.pooler.supabase.com') and unquote(u.username or '') == f'postgres.{ref}')
    except (ValueError, TypeError):
        return False


if __name__ == '__main__':
    # hostaddr and service can redirect even a URL that looks correct.
    if any(os.environ.get(k) for k in ('PGHOSTADDR', 'PGSERVICE', 'PGSERVICEFILE')) or not allowed(
            os.environ.get('QHQ_DB_URL', ''), '--local-only' in sys.argv):
        sys.exit('ABORT: require an explicit local socket/loopback or approved DEV database endpoint; connection not attempted')
