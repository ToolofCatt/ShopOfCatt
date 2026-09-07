# Telegram Admin

## Kich hoat / Activation

1. SUPERADMIN web mo `/admin/telegram`, tab Quyen quan tri.
2. Them Telegram **User ID** (lenh `/whoami` trong chat rieng), ten va quyen.
3. Bat quan tri qua Telegram. Bot ban hang van can token va cong tac dang bat.
4. Nhan `/admin` trong chat rieng voi bot; `/cancel` huy form, `/start` ve luong khach.

Telegram User IDs are independent of web users. Only web SUPERADMIN can manage
the allowlist. Notification Chat IDs never grant administrative access.
New installations have no Telegram administrators and the feature is disabled.

## Permissions

| Role | Allowed |
|---|---|
| VIEWER | Read summaries, orders, products, inventory metadata, customers, settings status and audit |
| OPERATOR | Catalog/prices, imports, restore withdrawn stock, cancel pending orders, retry PAID delivery, coupons, support/content, lock/unlock ordinary customers |
| FULL | Manual payment confirmation, stock content/export/withdraw/delete, ordinary customer password reset, payment/rate/AI/notification settings |

No Telegram role can grant web admin, edit SUPERADMIN accounts, change the admin
allowlist, rotate the bot token, enable mock payments, or execute shell commands.
Page Builder, setup wizard, image editors and environment configuration remain web-only.
Product image management is unchanged on the web; Telegram edits text, price and state.

## Conversation

Menus use edit-in-place, opaque callback IDs and server-side sessions. Every
message/callback checks sender ID, private chat, current enabled flag and access
version. Revocation invalidates old controls. Forms expire after ten minutes or
process restart; confirmations expire after five minutes. Sensitive operations
require retyping the displayed target code; mark-paid requires a note.

Stock import accepts text and UTF-8 JSON/TXT documents up to 1 MB / 1,000 items.
The shared parser preserves an accounts wrapper per item. Withdrawal uses the
existing 500-item limit and the same SKIP LOCKED implementation as the website.
Keys are delivered as downloadable text documents, not truncated chat messages.
Secrets are write-only in forms, never included in confirmation summaries or
audit. The bot attempts to delete incoming secret messages; deletion is not
guaranteed by Telegram, and group administration is disabled.

## Transactions And Recovery

Inventory mutations and action receipts commit in one PostgreSQL transaction.
Receipts store counts/stock IDs, never key contents. Repeated confirmation returns
the existing receipt. Withdrawn-file retry uses those IDs without withdrawing again.

Other commands use a durable RUNNING receipt before the existing domain service.
An ambiguous failure becomes REVIEW rather than replaying a potentially committed
mutation. SUPERADMIN verifies the target and audit, then acknowledges the receipt
from the access tab. RUNNING receipts are reviewable after thirty minutes.
Acknowledgment does not re-execute the operation. Password-reset results live only
in the immediate response; after delivery failure, review the operation before
starting a new reset. No credentials are stored in action receipts.

Web and Telegram use the same services, DTO validation, money calculations and
fulfillment locks. Telegram-specific access/confirmation is in `telegram-admin`,
not a second payment or inventory implementation. Storefront actor history uses
WEB or TELEGRAM source with an independent Telegram ID/name snapshot.

## Preview And Verification

The admin simulator uses the production view/command definitions with fixture
data, never production mutations. Switch Customer/Admin and permission level.

```sh
pnpm typecheck
pnpm test
pnpm --filter @webcatt/api test -- src/telegram-admin
pnpm build
```

Integration tests replay migrations on a separate PostgreSQL database and check
duplicate confirmations, expiry, revocation, metadata-only audit, failed inventory
rollback and manual payment delivery. A test skip is not production verification.

## Release / Rollback

Back up before migration `20260907110000_telegram_admin`. Rebuild only API/web with
`docker compose up -d --build --no-deps api web`; do not restart the proxy.
Keep the admin feature disabled until the owner has added and reviewed IDs.
For rollback, disable Telegram administration, deploy previous API/web images and
retain the additive tables/columns. Do not drop inventory, order or action history.
