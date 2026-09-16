#!/usr/bin/env bash
# Linux only. Read-only inventory; HTTP probes may generate ordinary access logs.
# Never reads .env, process arguments/environment, private keys or application rows.
set -u
set -o pipefail

usage() {
  cat <<'USAGE'
Usage: bash ops/inspect-server.sh [--backend-port PORT] [--backend-pid PID]
       [--database /absolute/live/database.db]
       [--schema-snapshot /absolute/offline/complete-backup.db]

No installs, config edits, restarts, database writes or load tests.
--backend-port: one GET to /api/auth/me on 127.0.0.1; 401 is expected without login.
--backend-pid: read only this process's file-descriptor/resource limits, not its environment.
--database: only file metadata and the SQLite header; never opens the live DB with SQLite.
--schema-snapshot: OPTIONAL, a complete, offline, standalone backup you verified is not live.
  Reads table/column names using immutable+read-only SQLite. Never use a live DB here:
  immutable ignores concurrent writes and WAL. Existing WAL/journal files cause refusal.
Run as the normal application user first. No automatic sudo. Review output before sharing.
USAGE
}

backend_port=''
backend_pid=''
database_path=''
snapshot_path=''
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --backend-port|--backend-pid|--database|--schema-snapshot)
      if (($# < 2)); then printf 'Missing value: %s\n' "$1" >&2; exit 2; fi
      case "$1" in
        --backend-port) backend_port=$2 ;;
        --backend-pid) backend_pid=$2 ;;
        --database) database_path=$2 ;;
        --schema-snapshot) snapshot_path=$2 ;;
      esac
      shift 2 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

if [[ -n "$backend_port" ]]; then
  if [[ ! "$backend_port" =~ ^[0-9]{1,5}$ ]] || ((10#$backend_port < 1 || 10#$backend_port > 65535)); then
    printf 'Invalid backend port.\n' >&2; exit 2
  fi
  backend_port=$((10#$backend_port))
fi
if [[ -n "$backend_pid" && ! "$backend_pid" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Invalid backend PID.\n' >&2; exit 2
fi
for supplied_path in "$database_path" "$snapshot_path"; do
  [[ -z "$supplied_path" ]] && continue
  if [[ "$supplied_path" != /* || ! -f "$supplied_path" || ! -r "$supplied_path" ]]; then
    printf 'Database paths must be absolute, existing, readable regular files.\n' >&2; exit 2
  fi
done
if [[ "$(uname -s)" != Linux ]]; then
  printf 'Run this script on the Linux server; no diagnostics were executed.\n' >&2; exit 2
fi

section() { printf '\n--- %s ---\n' "$1"; }
run_if_present() {
  if command -v "$1" >/dev/null 2>&1; then "$@"; else printf '%s: unavailable (not installed by this script)\n' "$1"; fi
}

section 'Time / OS / CPU / memory / disk'
date -u '+%Y-%m-%dT%H:%M:%SZ'
uname -srmo
if [[ -r /etc/os-release ]]; then
  awk -F= '$1 == "NAME" || $1 == "VERSION_ID" { print }' /etc/os-release
fi
run_if_present nproc
run_if_present uptime
run_if_present free -m
run_if_present df -hP
run_if_present df -iP
run_if_present vmstat 1 3

section 'Largest resident processes: executable name only, no command arguments'
if command -v ps >/dev/null 2>&1; then
  ps -eo pid,ppid,comm,pcpu,pmem,rss --sort=-rss | head -n 16
fi

section 'TCP listeners and connection totals: no remote peer list'
run_if_present ss -lnt
run_if_present ss -s
if command -v ss >/dev/null 2>&1; then
  ss -Hant | awk '{ count[$1]++ } END { for (state in count) print state, count[state] }'
fi

section 'Shell limits and kernel queue/file settings'
ulimit -Sn
ulimit -Hn
for proc_setting in /proc/sys/fs/file-nr /proc/sys/net/core/somaxconn /proc/sys/net/ipv4/tcp_max_syn_backlog; do
  if [[ -r "$proc_setting" ]]; then printf '%s: ' "$proc_setting"; cat "$proc_setting"; fi
done
if [[ -n "$backend_pid" ]]; then
  section 'Selected backend process limits (the shell limit above is not the service limit)'
  if [[ -r "/proc/$backend_pid/limits" ]]; then
    awk 'NR == 1 || /Max open files|Max processes|Max address space/ { print }' "/proc/$backend_pid/limits"
    if [[ -r "/proc/$backend_pid/fd" ]]; then
      printf 'Open file descriptors: '
      find "/proc/$backend_pid/fd" -mindepth 1 -maxdepth 1 -type l 2>/dev/null | wc -l
    fi
  else
    printf 'PID absent or not readable.\n'
  fi
fi

section 'Nginx version / Node version'
run_if_present nginx -v
run_if_present node --version

section 'Selected Nginx settings from common config locations'
if command -v python3 >/dev/null 2>&1; then
  python3 - <<'PY'
import glob, pathlib, re
# Read files directly; nginx -T/-t can open configured logs and is not run here.
# Only validated numeric/boolean settings and restricted MIME values are printed.
# No raw config, proxy URL, headers, certificates, logging formats or environment.
files = ['/etc/nginx/nginx.conf']
files += glob.glob('/etc/nginx/conf.d/*.conf')
files += glob.glob('/etc/nginx/sites-enabled/*')
numeric = {'worker_processes', 'worker_connections', 'worker_rlimit_nofile',
           'keepalive_timeout', 'keepalive_requests', 'keepalive',
           'proxy_connect_timeout', 'proxy_read_timeout', 'proxy_send_timeout',
           'client_body_timeout', 'client_header_timeout', 'send_timeout',
           'client_max_body_size', 'gzip_min_length', 'gzip_comp_level'}
boolean = {'sendfile', 'tcp_nopush', 'tcp_nodelay', 'gzip', 'gzip_vary',
           'proxy_buffering', 'multi_accept'}
presence = {'proxy_pass', 'proxy_cache', 'proxy_cache_bypass', 'proxy_no_cache',
            'proxy_http_version', 'add_header', 'expires', 'try_files', 'listen'}
seen = set()
for filename in files:
    p = pathlib.Path(filename)
    try:
        resolved = p.resolve()
        if resolved in seen or not p.is_file() or p.stat().st_size > 2_000_000:
            continue
        seen.add(resolved)
        lines = p.read_text(errors='replace').splitlines()
    except OSError:
        print(f'{filename}: not readable; skipped')
        continue
    for index, line in enumerate(lines, 1):
        clean = line.split('#', 1)[0]
        for match in re.finditer(r'(?:^|[;{}])\s*([a-z_]+)\s+([^;{}]+);', clean):
            key, value = match.group(1), match.group(2).strip()
            shown = None
            if key in numeric and re.fullmatch(r'(?:auto|[0-9]+[smhkMgG]?)(?:\s+[0-9]+[smhkMgG]?)*', value):
                shown = value
            elif key in boolean and value in {'on', 'off'}:
                shown = value
            elif key == 'gzip_types' and re.fullmatch(r'[a-z0-9+./\-\s]+', value):
                shown = value
            elif key in presence:
                shown = '[configured; inspect context privately]'
            if shown is not None:
                print(f'{filename}:{index}: {key} {shown}')
print('Partial inventory only: custom includes, multi-line directives and scope inheritance are not resolved.')
print('Missing output does not prove a directive is disabled or absent.')
PY
else
  printf 'python3 unavailable; selected config inventory skipped.\n'
fi

section 'Optional local API reachability (not a database readiness test)'
if [[ -n "$backend_port" ]]; then
  if command -v curl >/dev/null 2>&1; then
    curl --noproxy '*' --silent --show-error --connect-timeout 3 --max-time 8 \
      --output /dev/null --write-out 'status=%{http_code} connect=%{time_connect}s first_byte=%{time_starttransfer}s total=%{time_total}s\n' \
      "http://127.0.0.1:$backend_port/api/auth/me"
    printf 'Expected unauthenticated result: HTTP 401. HTTP 401 does not prove DB read/write readiness.\n'
  else
    printf 'curl unavailable; probe skipped.\n'
  fi
else
  printf 'Skipped: specify the actual port with --backend-port; no legacy port is assumed.\n'
fi

section 'Optional database metadata / offline schema'
if [[ -n "$database_path" || -n "$snapshot_path" ]]; then
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$database_path" "$snapshot_path" <<'PY'
import os, pathlib, sqlite3, stat, struct, sys
live, snapshot = sys.argv[1:]
def metadata(filename):
    p = pathlib.Path(filename).resolve(strict=True)
    st = p.stat()
    if not stat.S_ISREG(st.st_mode):
        raise ValueError('not a regular file')
    print(f'Path: {p}; size={st.st_size}; mode={oct(stat.S_IMODE(st.st_mode))}; uid={st.st_uid}; gid={st.st_gid}')
    with p.open('rb') as fh:
        header = fh.read(100)
    if len(header) < 100 or header[:16] != b'SQLite format 3\x00':
        print('Not a complete SQLite3 header; skipped.')
        return None
    print('Header read/write formats:', header[19], header[18], '(1=rollback, 2=WAL; header observation only)')
    print('Header schema cookie:', struct.unpack('>I', header[40:44])[0])
    for suffix in ('-wal', '-shm', '-journal'):
        auxiliary = pathlib.Path(str(p) + suffix)
        if auxiliary.exists():
            print(f'{suffix}: {auxiliary.stat().st_size} bytes')
    return p
if live:
    try:
        metadata(live)
        print('Live database was not opened by SQLite; no application rows were read.')
    except (OSError, ValueError) as exc:
        print(f'Live metadata unavailable: {type(exc).__name__}')
if snapshot:
    try:
        p = metadata(snapshot)
        if p is None:
            raise ValueError('invalid header')
        if live and os.path.samefile(live, p):
            raise ValueError('snapshot is the live database')
        if any(pathlib.Path(str(p) + suffix).exists() for suffix in ('-wal', '-shm', '-journal')):
            raise ValueError('snapshot has SQLite auxiliary files; provide an offline standalone backup')
        print('Schema is for the administrator-designated offline snapshot ONLY, not proof of live state.')
        conn = sqlite3.connect(p.as_uri() + '?mode=ro&immutable=1', uri=True, timeout=1)
        try:
            expected = {'events', 'staff_whitelist', 'badges', 'booth_view_records',
                        'user_badges', 'claim_tokens', 'redemptions', 'schema_migrations'}
            found = {row[0] for row in conn.execute("SELECT name FROM sqlite_schema WHERE type='table'")}
            for name in sorted(expected):
                if name not in found:
                    print(f'{name}: MISSING')
                    continue
                columns = [row[1] for row in conn.execute('SELECT * FROM pragma_table_info(?)', (name,))]
                # Print only identifier-like schema names, never definitions/default values.
                safe = [column for column in columns if column.isascii() and column.replace('_', '').isalnum()]
                print(f'{name}: {", ".join(safe)}')
        finally:
            conn.close()
    except (OSError, ValueError, sqlite3.Error) as exc:
        print(f'Snapshot schema skipped: {type(exc).__name__}: {exc}')
PY
  else
    printf 'python3 unavailable; database checks skipped.\n'
  fi
else
  printf 'Skipped: no database paths supplied; the script never guesses or creates a DB.\n'
fi

section 'Console facts still required'
printf '%s\n' \
  'Aliyun console: ECS region, instance specification, public bandwidth cap/billing mode, bandwidth graph, security groups, disk capacity/IOPS, snapshots.' \
  'Domain console: authoritative DNS records, www/apex records, CDN/proxy state, certificate renewal ownership.' \
  'School networks: Wi-Fi and mobile-carrier reachability/latency need real device checks on those networks.' \
  'This inventory does not establish a supported concurrency level. No production load test was run.'
