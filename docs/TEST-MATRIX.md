# Test matrix

| Area | Required evidence |
|---|---|
| Shared schema | valid defaults, required business blocks, nesting/ID/theme rejection |
| Draft | CAS conflict, sanitize, no lost update across two tabs |
| Publish | immutable snapshots, restore-as-new, latest 20 retained |
| Media | MIME + magic bytes + dimensions + size, SVG/XSS rejected |
| Setup | fresh maintenance, legacy published backfill, pass/warn/fail/stale |
| Inventory probe | real PostgreSQL locks, rollback, unchanged business counts |
| Payments | at least one real method, mock off, invalid webhook returns 401 |
| Permissions | ADMIN draft/media; SUPERADMIN publish/setup/maintenance |
| Builder | drag, keyboard, undo/redo, autosave, page/locale/device toolbar |
| Runtime | every public template, VI/EN/ZH, desktop/mobile, CSP/XSS |
| Release | secret scan, tracked files only, SHA-256 manifest, clean extraction |
| Deployment | backup, migrations, Docker API/web, health, bot polling, no proxy restart |
