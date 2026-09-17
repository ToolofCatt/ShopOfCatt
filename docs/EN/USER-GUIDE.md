# Digital Store user guide

## Quick start

Digital Store is a self-hosted source package for one digital-goods store per
deployment and database. It has no runtime licence server or automatic updater.

```bash
chmod +x install.sh storectl
./install.sh --domain shop.example.com --admin-email owner@example.com
```

When passing `--admin-password`, use 12-128 letters, numbers, or
`._~@%+=:-`. This keeps the generated `.env` valid for both Docker Compose and
`storectl`; omit the option to let the installer generate a strong password.

The installer validates Ubuntu/Debian, Docker Compose, DNS and ports; generates
secrets; writes a mode-600 `.env`; starts the stack; and prints the login URL.
Customers see **Store setup in progress** until the owner publishes.

## Six-step setup

Open `/admin/setup` and complete:

1. **System & store:** database, migrations, private secrets, HTTPS/CORS,
   backup heartbeat and a changed SUPERADMIN password.
2. **Brand & design:** store name, logo, favicon, valid page document and
   desktop/mobile previews.
3. **Payments:** at least one working real method, mock disabled, read-only
   Binance permissions where configured, and fail-closed webhook auth.
4. **Channels & automation:** support contact and all policies; optional
   Telegram/AI integrations must connect when enabled.
5. **Catalog & stock:** an active product/variant and deliverable stock. The
   diagnostic uses real PostgreSQL locks and intentionally rolls back.
6. **Review & publish:** the server reruns every blocker before publishing.

Check states are `pass`, `warn`, `fail`, and `stale`. Published stores are not
automatically closed by a later transient failure; readiness keeps warning and
payments remain fail-closed.

## Page Builder

Open `/admin/design`. Drag layout/content blocks from the palette, edit the
selected block in the inspector, and switch page, VI/EN/ZH, or desktop/mobile
from the toolbar. Drafts autosave after about 800 ms with compare-and-swap
versioning. Undo/redo affects only the draft.

Business blocks such as product browsing, buy box, payment selection, order
status, and delivered keys can move but cannot be deleted, duplicated, or have
their data logic edited. Custom JavaScript/CSS and payment destinations are not
accepted. Rich text is sanitized by the API.

Publishing creates an immutable revision. The latest 20 are retained; restore
publishes a new revision instead of rewriting history. Public pages and preview
use the same `StorefrontRenderer`.

Media is PNG/JPEG/WebP only, no larger than 1 MB or 2400 x 2400 px. Both browser
and API validate it; the API trusts magic bytes rather than MIME metadata.

## Payments, Telegram, and inventory

Production requires `PAYMENT_MOCK=false` plus the database mock toggle off.
Amounts are recomputed from the database. Each `StockItem` row is one paid
deliverable and reservations use `FOR UPDATE SKIP LOCKED` in one transaction.
Binance account keys must have reading enabled and withdrawal/trading disabled.

Telegram settings live at `/admin/telegram`; bot tokens are write-only from the
browser's perspective. AI translation is optional and its key is never returned
to UI or audit logs.

Setup payment checks never transfer money. Invalid webhook credentials are
expected to be rejected, and the inventory check rolls back without creating an
order, outbox event, or stock change.

## Operations and recovery

```bash
./storectl status
./storectl logs api
./storectl doctor
./storectl doctor --json
./storectl backup
# Replace the example with exactly one trusted, existing dump.
./storectl restore --rehearsal backups/webcatt-20260917-010000-AbCd1234.sql.gz
# Destructive restore requires approved downtime; keep writers stopped for review.
./storectl restore --no-start backups/webcatt-20260917-010000-AbCd1234.sql.gz
```

Backup runs once and returns its actual exit status. The heartbeat in
`backup-status/.last-success.json` is written only after successful `pg_dump`,
`gzip -t`, and dump-end checks. API mounts only this metadata, never the dumps.
Keep the dump directory mode 700 and dump files 600; replicate them off-host.
Restore rehearses SQL in a temporary database before stopping or dropping the
target, and errors never automatically restart writers. Rehearsal is not a
sandbox for untrusted SQL. Do not rerun the installer: preserve the original
`.env`, credentials and volume, and resume the same Compose deployment after
investigation. See the [deployment runbook](../TRIEN-KHAI.md) for heartbeat
migration, isolated staging and rollback limitations after new transactions.

For failures, rerun stale checks, inspect every fail row, check API/container
logs and verify DNS/HTTPS. Read `AGENTS.md` and `docs/AGENT-GUIDE.md` before
changing payment, order, wallet, or stock code.

## Distribution rights

Original code is MIT licensed. Recipients may modify, redistribute, sublicense,
or sell it while retaining required copyright/licence notices and third-party
notices. No runtime licence, update service, or update commitment is included.
