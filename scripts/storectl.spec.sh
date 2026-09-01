#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
FIXTURE=$(mktemp -d)
trap 'rm -rf "$FIXTURE"' EXIT

cp "$ROOT/storectl" "$FIXTURE/storectl"
chmod +x "$FIXTURE/storectl"
mkdir -p "$FIXTURE/bin" "$FIXTURE/backups"

cat > "$FIXTURE/.env" <<'EOF'
JWT_SECRET=0123456789abcdef0123456789abcdef
SITE_DOMAIN=cattshop.site
NEXT_PUBLIC_SITE_NAME=Catt Store
EOF
chmod 600 "$FIXTURE/.env"

cat > "$FIXTURE/bin/docker" <<'EOF'
#!/bin/sh
if [ "${1:-}" != compose ]; then exit 1; fi
shift
case "${1:-}" in
  version) exit 0 ;;
  exec) exit 0 ;;
  ps)
    case "${2:-}" in
      postgres|api|web) printf 'running healthy\n' ;;
      backup) printf 'running\n' ;;
      proxy) [ "${STORECTL_PROXY_STATE:-running}" = missing ] || printf 'running\n' ;;
    esac
    exit 0
    ;;
esac
exit 1
EOF
chmod +x "$FIXTURE/bin/docker"

cat > "$FIXTURE/bin/getent" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$FIXTURE/bin/getent"

cat > "$FIXTURE/bin/curl" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$FIXTURE/bin/curl"

printf 'backup fixture' | gzip > "$FIXTURE/backups/fixture.sql.gz"
printf '{"file":"fixture.sql.gz"}\n' > "$FIXTURE/backups/.last-success.json"

output=$(PATH="$FIXTURE/bin:$PATH" "$FIXTURE/storectl" doctor --json 2>&1) || {
  printf '%s\n' "$output" >&2
  exit 1
}

printf '%s' "$output" | grep -q '"ok":true'
printf '%s' "$output" | grep -q '"id":"jwt-secret","state":"pass"'
printf '%s' "$output" | grep -q '"id":"dns","state":"pass"'

external_output=$(STORECTL_PROXY_STATE=missing PATH="$FIXTURE/bin:$PATH" "$FIXTURE/storectl" doctor --json 2>&1) || {
  printf '%s\n' "$external_output" >&2
  exit 1
}
printf '%s' "$external_output" | grep -q '"ok":true'
printf '%s' "$external_output" | grep -q '"id":"proxy","state":"pass"'

rm "$FIXTURE/.env"
set +e
missing_output=$(PATH="$FIXTURE/bin:$PATH" "$FIXTURE/storectl" doctor --json 2>&1)
missing_status=$?
set -e
[ "$missing_status" -eq 1 ]
printf '%s' "$missing_output" | grep -q '"id":"env","state":"fail"'
printf '%s' "$missing_output" | grep -q '"ok":false'
if printf '%s' "$missing_output" | grep -q 'No such file'; then
  printf '%s\n' "$missing_output" >&2
  exit 1
fi
printf 'storectl env parsing: PASS\n'
