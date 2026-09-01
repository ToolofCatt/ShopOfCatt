# Migration playbook

1. Back up production and verify the gzip and dump-end marker.
2. Edit `schema.prisma`; generate a named migration, never use `db push` in
   production.
3. Review SQL for destructive operations, table locks, defaults and backfills.
4. Replay every migration on an empty PostgreSQL database.
5. Migrate a copy of the previous production schema/data and verify invariants.
6. Run `prisma migrate deploy`, rebuild only required services and inspect health.
7. For storefront changes, preserve existing deployments as published while a
   truly fresh database remains in maintenance.

Rollback means application rollback plus database restore when SQL is not
backward-compatible. Never guess a reverse migration around paid orders or
`StockItem` rows.
