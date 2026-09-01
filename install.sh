#!/bin/sh
# Trình cài một cửa hàng Digital Store trên VPS Ubuntu/Debian.
set -eu

NON_INTERACTIVE=false
DOMAIN=""
ADMIN_EMAIL=""
ADMIN_PASSWORD=""

usage() {
  cat <<'EOF'
Usage: ./install.sh [--non-interactive] [--domain shop.example.com]
                    [--admin-email owner@example.com] [--admin-password value]
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --non-interactive) NON_INTERACTIVE=true ;;
    --domain) DOMAIN=${2:-}; shift ;;
    --admin-email) ADMIN_EMAIL=${2:-}; shift ;;
    --admin-password) ADMIN_PASSWORD=${2:-}; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

fail() { echo "[install] ERROR: $*" >&2; exit 1; }
info() { echo "[install] $*"; }

[ "$(uname -s)" = "Linux" ] || fail "Production installer supports Linux only."
[ -r /etc/os-release ] || fail "Cannot identify this Linux distribution."
# shellcheck disable=SC1091
. /etc/os-release
case "${ID:-}" in ubuntu|debian) ;; *) fail "Supported distributions: Ubuntu and Debian (found ${ID:-unknown})." ;; esac
command -v docker >/dev/null 2>&1 || fail "Docker Engine is missing: https://docs.docker.com/engine/install/"
docker compose version >/dev/null 2>&1 || fail "Docker Compose plugin is missing."
command -v openssl >/dev/null 2>&1 || fail "openssl is required to generate secrets."

if [ "$NON_INTERACTIVE" = false ]; then
  [ -n "$DOMAIN" ] || { printf 'Store domain (for example shop.example.com): '; read -r DOMAIN; }
  [ -n "$ADMIN_EMAIL" ] || { printf 'Owner email: '; read -r ADMIN_EMAIL; }
  if [ -z "$ADMIN_PASSWORD" ]; then
    printf 'Owner password (leave blank to generate): '
    stty -echo 2>/dev/null || true
    read -r ADMIN_PASSWORD
    stty echo 2>/dev/null || true
    printf '\n'
  fi
fi

[ -n "$DOMAIN" ] || fail "--domain is required in non-interactive mode."
[ -n "$ADMIN_EMAIL" ] || fail "--admin-email is required in non-interactive mode."
echo "$DOMAIN" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$' || fail "Invalid domain."
echo "$ADMIN_EMAIL" | grep -Eq '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' || fail "Invalid owner email."

if command -v ss >/dev/null 2>&1; then
  if ss -ltnH | awk '{print $4}' | grep -Eq '(^|:)(80|443)$'; then
    if ! docker compose ps --services --status running 2>/dev/null | grep -qx proxy; then
      fail "Port 80 or 443 is already in use."
    fi
  fi
fi

if command -v getent >/dev/null 2>&1 && ! getent ahostsv4 "$DOMAIN" >/dev/null 2>&1; then
  fail "DNS for $DOMAIN does not resolve yet. Point A/AAAA records to this VPS first."
fi

GENERATED_PASSWORD=false
if [ -z "$ADMIN_PASSWORD" ]; then ADMIN_PASSWORD=$(openssl rand -hex 18); GENERATED_PASSWORD=true; fi
# File .env này vừa được Docker Compose đọc vừa được `storectl` nạp bằng shell.
# Chặn ký tự có thể đổi cú pháp thay vì âm thầm sinh file cài đặt không đọc được.
echo "$ADMIN_PASSWORD" | grep -Eq '^[A-Za-z0-9._~@%+=:-]{12,128}$' || fail "Owner password must be 12-128 characters using letters, numbers, or ._~@%+=:-"
JWT_SECRET=$(openssl rand -base64 48 | tr -d '\r\n')
POSTGRES_PASSWORD=$(openssl rand -hex 24)

umask 077
[ ! -e .env ] || cp .env ".env.before-install.$(date -u +%Y%m%d-%H%M%S)"
cat > .env <<EOF
JWT_SECRET=$JWT_SECRET
POSTGRES_USER=postgres
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=webcatt
POSTGRES_PORT=5433
WEB_PORT=3000
API_PORT=3001
APP_BIND=127.0.0.1
SITE_DOMAIN=$DOMAIN
ACME_EMAIL=$ADMIN_EMAIL
WEB_URL=https://$DOMAIN
API_PUBLIC_URL=https://$DOMAIN
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_SITE_NAME='Digital Store'
NEXT_PUBLIC_SITE_URL=https://$DOMAIN
PAYMENT_MOCK=false
ORDER_EXPIRE_MINUTES=30
SEPAY_EXPIRE_MINUTES=10
TZ=Asia/Ho_Chi_Minh
ADMIN_EMAIL=$ADMIN_EMAIL
ADMIN_PASSWORD='$ADMIN_PASSWORD'
SEED_ON_START=true
SEED_DEMO=false
BACKUP_INTERVAL=86400
BACKUP_KEEP=14
EOF
chmod 600 .env
mkdir -p backups

info "Validating Docker Compose configuration..."
docker compose config --quiet
info "Building and starting PostgreSQL, API, web, backup, and HTTPS proxy..."
docker compose up -d --build

attempt=0
while [ "$attempt" -lt 60 ]; do
  ready=true
  for service in postgres api web; do
    [ "$(docker compose ps "$service" --format '{{.Health}}' 2>/dev/null)" = healthy ] || ready=false
  done
  [ "$ready" = true ] && break
  attempt=$((attempt + 1)); sleep 3
done
[ "$attempt" -lt 60 ] || { docker compose ps; fail "PostgreSQL, API, or web did not become healthy within 180 seconds."; }

info "Installation finished."
echo "Store: https://$DOMAIN"
echo "Admin login: https://$DOMAIN/login"
echo "Setup wizard: https://$DOMAIN/admin/setup"
echo "Owner email: $ADMIN_EMAIL"
if [ "$GENERATED_PASSWORD" = true ]; then echo "Generated owner password (shown once): $ADMIN_PASSWORD"; fi
echo "Run ./storectl doctor to verify DNS, HTTPS, migrations, containers, and backups."
