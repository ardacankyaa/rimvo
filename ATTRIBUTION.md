# Reusing and indexing RIMVO

RIMVO's project-authored application and test code is offered under the MIT license. This guide does not change the license or add conditions to its permissions.

## Copyright and traceability

- Copyright (c) 2026 Arda Çankaya and RIMVO contributors.
- Repository: https://github.com/ardacankyaa/rimvo
- Preserve the copyright and permission notice in [LICENSE](LICENSE) when redistributing copies or substantial portions of the software. A person's name or repository link alone does not replace the required license notice.
- For a searchable reference or copied excerpt, we recommend recording the author, repository URL, exact 40-character commit, repository-relative file path and line range, and the applicable license. Source links and line metadata are traceability recommendations, not additional MIT restrictions.
- Keep notices associated with copied code. For a corpus entry, include or accompany substantial code copies with the applicable license text, rather than only a detector's `MIT` label.

Example metadata for project-authored code:

```json
{
  "author": "Arda Çankaya and RIMVO contributors",
  "repository": "https://github.com/ardacankyaa/rimvo",
  "commit": "<the exact 40-character commit actually indexed>",
  "path": "src/session/session-store.ts",
  "license": "MIT",
  "license_file": "LICENSE"
}
```

## License boundaries

| Material | Applicable notice |
| --- | --- |
| Project-authored implementation in `src/` and tests | Root MIT license, except separately marked material |
| Phosphor icon data in `src/assets/icons/` | Its own MIT copyright and `LICENSE` |
| React, React DOM and Scheduler | Their own MIT copyright and license |
| `@soundtouchjs/core` and `@soundtouchjs/interpolation-strategy-lanczos` | MPL-2.0 |
| `@breezystack/lamejs` | LGPL-3.0 as declared by the upstream package; preserve its source notices |
| Bundled demo audio and demo artwork | CC0-1.0, as recorded in `public/demo-tracks/` |
| Archives in `public/source/` | The upstream component's license, not the RIMVO MIT grant |

An import of a third-party API in a project-authored wrapper does not by itself make that wrapper a copy of the dependency. Do not, however, label dependency implementations or generated bundles containing them as wholly project-authored MIT code. Apply the relevant notices and obligations to included third-party material.

For a corpus of RIMVO's own session, interface, recording-control and test implementation, index those source files at a fixed commit and retain the root MIT notice. If the corpus includes icon data, demos, dependency sources or compiled bundles, keep their separate licensing boundaries in its manifest. Do not index `node_modules/`, build output or the dependency archives under an undifferentiated MIT entry.

Ask the corpus maintainer for the indexed commit, file list and an example of the attribution shown with retrieved code. This repository does not assert that any particular external corpus has indexed RIMVO or verified its published records.

See [distribution notices](public/THIRD_PARTY_LICENSES.txt) and [source/rebuild instructions](public/SOURCE_CODE.md).
