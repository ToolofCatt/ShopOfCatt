# Release checklist

- [ ] Working tree contains only intended files; no `.env`, backup, DB, session,
      scratchpad, token, production domain or host.
- [ ] `pnpm typecheck`, `pnpm test`, PostgreSQL integration and `pnpm build` pass.
- [ ] Empty migration replay and existing-production migration pass.
- [ ] Docker API/web images build on Linux.
- [ ] Page Builder screenshots pass on desktop/mobile for all page templates.
- [ ] Fresh install stays in maintenance; complete wizard can publish.
- [ ] Existing deployment remains published after migration.
- [ ] `pnpm release:zip` succeeds from a clean commit.
- [ ] Extract ZIP, verify `RELEASE-MANIFEST.sha256`, install dependencies, replay
      migrations and build Docker in the clean directory.
- [ ] Keep `LICENSE`, `THIRD_PARTY_NOTICES`, user guides and agent docs in ZIP.
- [ ] Back up production before deploy; rebuild API/web/backup only and leave
      proxy untouched.
