# Release a version

The updater accepts stable GitHub releases from `iyk2h/herdr-approvals`.
The release tag uses `vX.Y.Z`. Drafts and prereleases do not appear as updates.

1. Set the same version in `package.json` and `mods/approvals/version.js`.
2. Add the changes to `CHANGELOG.md`.
3. Run `npm test`, `npm run check:install`, `npm run check:updates`, and `npm run check:package`.
4. Run `python3 tools/native-check.py` and `python3 tools/update-smoke.py` on macOS.
5. Run `npm run build:release`.
6. Commit and push the tested files. Wait for CI to pass.
7. Create a draft release for that commit and attach both files from `dist/`.
8. Examine the tag, notes, archive, and checksum. Then publish the release.

The required files use these names:

```text
herdr-approval-X.Y.Z.zip
herdr-approval-X.Y.Z.zip.sha256
```

The builder includes only the mod and its licenses. It excludes settings, generated declarations, caches, and development files.
The checksum file names the exact archive. The runtime version must match the selected release.
Publish a new version for later changes. Keep published release files unchanged.

The first updater release is `0.2.0`. Earlier installations require one manual update to receive the update controls.
