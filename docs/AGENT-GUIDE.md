# Agent guide

Start with `AGENTS.md`; its money/stock and security constraints override
ordinary refactoring preferences.

## Project map

- `apps/api`: NestJS, Prisma and PostgreSQL. Orders, payment matching, wallet,
  fulfilment, setup checks and immutable storefront snapshots live here.
- `apps/web`: Next.js App Router. Customer pages, admin wizard and Page Builder.
- `packages/shared`: the only API/web contract. `storefront.ts` is the strict
  discriminated document parser.
- `docker`: Caddy, verified backup and restore scripts.

## Storefront change protocol

1. Add a block type and TypeScript contract to `packages/shared/src/storefront.ts`.
2. Extend strict validation, the default document, `StorefrontRenderer`, builder
   palette/inspector and unit tests in the same change.
3. Business blocks must remain exactly once on their designated page. Never put
   payment or delivered-key logic into JSON props.
4. Rich text must use the API sanitizer. Media must retain dual browser/API
   validation and reject SVG.
5. Schema changes need a migration, empty-database replay and existing-production
   migration test.

## Money and stock protocol

Lock `Order` before `StockItem`, reserve with `FOR UPDATE SKIP LOCKED` inside one
transaction, recompute money from DB data, use conditional state changes, and
match crypto only through the established matchers. Never create an alternate
"setup test" purchase path. The setup inventory probe must intentionally
rollback and leave Order/Product/StockItem counts unchanged.

## Required verification

Run `pnpm typecheck`, `pnpm test`, PostgreSQL integration tests, `pnpm build`,
Docker API/web builds, and `pnpm release:zip`. Extract the ZIP into a clean
directory, verify its SHA-256 manifest, replay migrations on an empty database,
and run `storectl doctor --json`.
