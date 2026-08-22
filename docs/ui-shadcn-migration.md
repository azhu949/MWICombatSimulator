# UI shadcn-vue Migration

## Status

- Overall status: `completed`
- Current phase: `8. Cleanup and final QA` (completed)
- Last updated: `2026-08-08`
- Design read: dense combat-data workspace for experienced Milky Way Idle players
- Design dials: variance `3`, motion `2`, density `7`

## Decisions

- Preserve the dark graphite and amber product identity, existing routes, copy, stores, workers, and import/export formats.
- Use Vue 3, Vite, JavaScript, Tailwind 4, shadcn-vue source components, Reka UI primitives, and Lucide icons.
- Keep dark mode as the default and retain the `mwi.ui.theme.v1` storage key.
- Keep Chart.js and existing route-level lazy loading. Do not introduce TanStack Table.
- Ship after all phases are complete; intermediate phases may temporarily contain compatibility styles.
- Use the in-app browser for visual QA. Do not use Playwright MCP.

### Explicitly out of scope

- No changes to route paths, route names, Hash History, store APIs, worker messages, simulation data, or import/export formats.
- No changes to existing Chinese/English copy or translation keys beyond labels required by new controls.
- No changes to game calculations, queue semantics, Chart.js behavior, item SVG sprites, or lazy-loading boundaries.

## Page migration matrix

| Page or area       | Migrated primitives                                                       | Notes                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Application shell  | Sidebar, Sheet, Dropdown Menu, Tooltip, Separator                         | Responsive groups and route metadata preserve existing navigation.                                                                  |
| Home               | Field, Label, Select, Combobox, Number Field, Button, Badge, Table, Empty | Short simulation enums use Reka Select; the 55-item battle target list and other large game-data lists use bounded Combobox search. |
| Simulation Results | Table, Badge, Progress, Separator, Empty                                  | Sticky summary and horizontal table scrolling are preserved.                                                                        |
| Queue              | Table, Badge, Progress, Tabs, Empty                                       | Status and ranking presentation use semantic tokens.                                                                                |
| Multi Results      | Table, Badge, Progress, Empty                                             | Long result sets scroll horizontally without page overflow.                                                                         |
| Advisor            | Combobox, Select, Table, Badge, Empty                                     | Searchable game data lists retain result limits.                                                                                    |
| Enhancement        | Select, Combobox, Number Field, Dialog, Table, Badge, Progress            | Desktop two-column workspace collapses to one column on mobile.                                                                     |
| Skilling           | Select, Combobox, Number Field, Dialog, Table, Badge, Progress            | Existing Chart.js and planner calculations remain unchanged.                                                                        |
| Settings           | Tabs, Select, Native Select, Number Field, Input, Button                  | Queue, pricing, and loadout groups keep field order.                                                                                |
| Guide              | Accordion, Tabs, Separator, Dialog, figures                               | Anchors, bilingual content, and tutorial images remain available.                                                                   |

## Baseline

| Check             | Result                                           |
| ----------------- | ------------------------------------------------ |
| Unit tests        | 59 files, 559 tests passed                       |
| Production build  | Passed with Vite 5.4.21                          |
| Main CSS          | 52.96 kB, 10.05 kB gzip                          |
| Main JS           | 1,132.80 kB, 373.85 kB gzip                      |
| Existing warnings | Large chunk warnings for app/data/worker bundles |

## Migration Matrix

| Phase                                         | Status      | Scope                                                                     | Completion gate                                | Evidence                                                                                                                      |
| --------------------------------------------- | ----------- | ------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 1. Tailwind 4 and shadcn-vue infrastructure   | `completed` | Vite plugin, aliases, component registry, local fonts                     | Build and all tests pass                       | Migration-stage build and test gate passed; final counts are recorded in Phase 8                                              |
| 2. Theme tokens and shared components         | `completed` | Semantic tokens, Button, Dialog, Collapsible, form and display primitives | Shared component tests pass                    | Theme, Dialog, Collapsible, Table, Select, and accessibility behavior covered by UI tests                                     |
| 3. App shell, sidebar, and combat command bar | `completed` | Responsive sidebar, header, global actions, contextual combat tools       | Shell tests and responsive smoke checks pass   | Shell behavior tests pass; sidebar, collapse/drawer, and command overflow verified at all three viewports                     |
| 4. Home and Simulation Results                | `completed` | Workspace, summary rail, results hierarchy and tables                     | Home/results tests and populated-state QA pass | Home and results tests pass; empty/populated tables, sticky summary, and overflow verified                                    |
| 5. Queue, Multi Results, and Advisor          | `completed` | Status, ranking, progress, empty states and tables                        | Route tests and empty/populated QA pass        | Queue, multi-results, and advisor tests pass; status, ranking, progress, search, and empty states verified                    |
| 6. Enhancement and Skilling                   | `completed` | Two-column workspaces, dialogs, controls, ledgers and tables              | Existing feature tests and responsive QA pass  | Feature suites pass; desktop two-column and mobile single-column layouts verified                                             |
| 7. Settings and Guide                         | `completed` | Settings grouping, guide navigation, accordions and figures               | Settings/guide tests and anchor checks pass    | Settings tabs, Guide accordion/anchors, bilingual labels, and dialog interactions verified                                    |
| 8. Cleanup and final QA                       | `completed` | Remove legacy styling, full tests/build, desktop/mobile themes            | All automated and browser checks pass          | Full suite/build/page verification passed; static scan and browser matrix complete, including the final Select/Combobox audit |

## Component Inventory

| Area         | Target components                                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Shell        | Sidebar, Sheet, Dropdown Menu, Tooltip, Scroll Area                                                                              |
| Feedback     | Dialog, Alert Dialog, Alert, Sonner, Progress, Skeleton, Empty                                                                   |
| Forms        | Field, Label, Input, Input Group, Number Field, Select, Native Select, Combobox, Checkbox, Switch, Radio Group, Slider, Textarea |
| Data display | Button, Button Group, Badge, Tabs, Separator, Table, Collapsible, Accordion                                                      |

## Verification Log

| Phase    | Commands                                                                                                                                                                                | Browser coverage                                                                                            | Result                                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Baseline | `npm test -- --reporter=dot`; `npm run build`                                                                                                                                           | Existing tutorial screenshots reviewed                                                                      | Passed: 59 files / 559 tests; CSS 52.96 kB (10.05 kB gzip), main JS 1,132.80 kB (373.85 kB gzip)                            |
| 1        | `npm test -- --reporter=dot`; `npm run build`                                                                                                                                           | Deferred until the shell was available                                                                      | Passed during migration; Tailwind 4 plugin, aliases, registry, and self-hosted fonts verified                               |
| 2        | `npx vitest run src/ui/__tests__/themeAndSharedComponents.test.js src/ui/__tests__/interactivePrimitives.test.js --reporter=verbose`; `npm run build`                                   | Dark/light tokens, focus rings, Dialog and Collapsible smoke checks                                         | Passed; shared primitive behavior and theme persistence covered                                                             |
| 3        | `npx vitest run src/ui/__tests__/App.template.test.js src/ui/__tests__/appShellBehavior.test.js --reporter=verbose`                                                                     | `home`, `queue`, `multi-results`: 1440x900, 1024x768, 390x844; sidebar collapse/drawer and command overflow | Passed; route metadata, mobile Sheet, desktop icon rail, global actions, and disabled command states verified               |
| 4        | `npx vitest run src/ui/__tests__/HomePage.template.test.js src/ui/__tests__/SimulationResultsView.template.test.js --reporter=verbose`                                                  | Home and Simulation Results in dark desktop/mobile, light and English core states; empty and populated data | Passed; no page overflow or summary/action overlap                                                                          |
| 5        | `npx vitest run src/ui/__tests__/QueuePage.template.test.js src/ui/__tests__/MultiResultsPage.template.test.js src/ui/__tests__/multiResultsPresentation.test.js --reporter=verbose`    | Queue, Multi Results, Advisor at all three viewports; empty, running, error, disabled, long-table states    | Passed; badges, progress, ranking tables, search empty state, and horizontal scrolling verified                             |
| 6        | `npx vitest run src/ui/__tests__/EnhancementPage.template.test.js src/ui/__tests__/SkillingPage.template.test.js src/ui/__tests__/skillingDrinkPresentation.test.js --reporter=verbose` | Enhancement and Skilling at 1440x900, 1024x768, 390x844; dialogs, controls, charts, and ledgers             | Passed; two-column desktop workspace and single-column mobile layout verified without button/label wrapping                 |
| 7        | `npx vitest run src/ui/__tests__/SettingsPage.template.test.js src/ui/__tests__/GuidePage.template.test.js --reporter=verbose`                                                          | Settings tabs and Guide anchors/Accordion in dark/light and English core checks                             | Passed; tab switching, anchor navigation, accordion states, figures, and focus behavior verified                            |
| 8        | `npm test`; `npm run build`; `npm run verify-pages-build`                                                                                                                               | All routes and states below; final console/overflow/overlap scan plus Select/Combobox audit                 | Passed: 64 files / 588 tests; CSS 67.47 kB (12.26 kB gzip); entry JS 1,281.39 kB (419.13 kB gzip); page verification passed |

### Final browser acceptance

- Routes: `home`, `advisor`, `enhancement`, `skilling`, `queue`, `multi-results`, `settings`, and `guide`.
- Viewports: `1440x900`, `1024x768`, and `390x844`.
- Themes and language: dark default on every route; light theme on core pages; English labels on core pages; immediate language label refresh verified.
- States: empty data, imported data, running, error, disabled controls, Dialog open/close, Reka Select keyboard selection, Combobox search/no-result and empty-value selection, Settings Tabs, Guide Accordion/anchors, Number Field increment/decrement, and long tables.
- Acceptance checks: no page-level horizontal overflow, no visible text overlap, no wrapped action buttons, complete keyboard focus indication, Dialog focus loop and Escape close, consistent light/dark hierarchy, no raw translation keys, and no global console errors.

### Final static scan

- No `.panel`, `.field-*`, or `.action-button-*` classes remain in `src/ui`.
- `tailwind.config.js` and `postcss.config.js` are absent; no Google Fonts references remain.
- No gradients, tracking utilities, or over-8px radius utilities remain in `src/ui`.
- Hard-coded UI colors are absent outside semantic theme definitions; Chart.js series colors and game item SVG sprites remain by design.

### Post-completion fixes

- `2026-08-08`: Fixed the Home region `SearchCombobox` so the selected label is not reused as the active search query. Opening an existing selection now shows the full list, typing filters normally, and option-label language changes refresh the closed value.
- Corrected the Reka UI positioning contract: `ComboboxContent` defaults to inline positioning, so a portalled inline list entered the document flow at the end of `body`. It now uses `position="popper"`, start alignment, a 4px side offset, and 8px collision padding against `ComboboxAnchor`.
- Locked Combobox content to the trigger width, capped it to the viewport, truncated long option labels, and removed the invalid interactive-control nesting from the Home target field. The regression test now asserts that content is rendered inside Reka's Popper wrapper.
- Browser verification: 55 region options on open, two matches for `地狱`, and successful `地狱深渊` selection. Desktop anchor/content coordinates were 468/472px; mobile coordinates were 440/444px with equal widths and no page-level horizontal overflow at 390x844.
- Regression verification: `src/ui/__tests__/interactivePrimitives.test.js` 10/10 passed; the final full suite is 64 files / 583 tests; production build passed.
- `2026-08-08`: Removed the leading search icon from the shared `SearchCombobox` and increased the input's horizontal padding for direct text alignment. Focus indication remains on the shadcn/Reka anchor ring, so keyboard feedback is preserved without an icon competing for space.
- Browser verification: the focused input computes to `outline-style: none`, the field contains zero `.lucide-search` icons, and its left padding is 12px. Searching `infernal` still returns only `Infernal Warlock` and `Infernal Abyss`, with no console errors. The 10-test interactive primitive regression suite and production build passed.
- `2026-08-08`: Restored the Home battle target (zone/dungeon) field to the Reka `SearchCombobox`. The list contains 55 game-data entries and therefore follows the migration rule for searchable large lists; profile, combat type, difficulty, labyrinth, and crate selectors remain Reka Select controls. The existing `selectedActionHrid` contract is unchanged.
- Browser re-verification: opening the region field displayed all 55 options; searching `infernal` reduced the list to `Infernal Warlock` and `Infernal Abyss`, and selecting `Infernal Abyss` closed the list and restored the selected label. The popper remained directly below the anchor, the input outline computed to `none`, the leading icon was absent, page width remained within the viewport, and no console errors were recorded.
- `2026-08-08`: Hardened the shared `SearchCombobox` for game-data lists that include a `None` option with the public empty-string value. Reka receives an internal `__mwi_combobox_empty__` sentinel while page/store events continue to receive `""`, preventing the Reka runtime exception when equipment, food, drink, or ability lists are opened.
- Browser verification: after a clean reload, the mobile Build & Skills equipment Combobox opened without an error dialog, displayed the `None` option, and selected it back to the empty public value; the icon-free input aligned correctly and page scroll width stayed within the 390px viewport. The focused-input outline computes to `none` and no new console errors were recorded after reload.
- Regression verification: `src/ui/__tests__/interactivePrimitives.test.js` 10/10 and `src/ui/__tests__/selectMigration.test.js` 4/4 passed; full suite 64 files / 583 tests passed; production build and `verify-pages-build` passed.
- Final mobile smoke: all eight routes (`home`, `advisor`, `enhancement`, `skilling`, `queue`, `multi-results`, `settings`, and `guide`) loaded their expected headings at 390x844 with no page-level horizontal overflow or dialogs. No application console errors were recorded after the clean post-fix reload.
- `2026-08-08`: Restored the Tampermonkey import control after the legacy `.action-button-tool` class was removed. The injected button now uses the shared `.button-tool` treatment, and idle, success, and error feedback use `text-muted-foreground`, `text-success`, and `text-destructive` semantic theme classes.
- Bumped the userscript from `0.1.29` to `0.1.30` so installed copies can receive the compatibility update. Added a source-contract regression that rejects the removed button class and legacy fixed-color status utilities.
- Browser verification: the shared tool-button treatment renders with a 36px height, 6px radius, solid success background, visible border, and high-contrast foreground in the dark theme; no application console errors were recorded. Userscript verification passed 9/9, the full suite passed 64 files / 584 tests, and production build plus `verify-pages-build` passed.
- `2026-08-08`: Packaged the completed UI migration as simulator version `2.0.0`. Updated the package metadata and lockfile, added the bilingual in-app `v2.0.0` patch note as the newest entry, and published the user-facing release document at `docs/release-2.0.0.md`.
- Release verification: patch-note and shell tests passed 15/15; the full suite passed 64 files / 588 tests; the Vite production build identified the package as `mwicombatsimulator@2.0.0`; `verify-pages-build` passed. Final CSS is 67.47 kB (12.26 kB gzip) and the entry JS is 1,281.39 kB (419.13 kB gzip).

### Phase 2 completion notes

- Added semantic dark/light OKLCH tokens, compact radii, status colors, visible focus rings, and reduced-motion handling.
- Added source-managed Button, Input, Label, Badge, Progress, Separator, Native Select, and Table primitives.
- Rebuilt `BaseModal` with Reka Dialog and `DisclosurePanel` with Reka Collapsible while preserving their public props and events.
- Centralized theme persistence in `useTheme` while retaining `mwi.ui.theme.v1` and dark-by-default behavior.

### Phase 1 completion notes

- Replaced the Tailwind 3/PostCSS setup with Tailwind 4 and `@tailwindcss/vite`.
- Added `components.json`, `jsconfig.json`, and the `@/* -> ./src/*` alias.
- Added the Reka UI, CVA, Tailwind Merge, Lucide, and animation dependencies required for source-managed shadcn-vue components.
- Replaced Google Fonts with self-hosted Fontsource packages for Chakra Petch and IBM Plex Sans.
- The CSS size is an intermediate migration measurement that still includes legacy-page compatibility rules.

## Known Issues

### Known issues

- Production build still reports large chunks for simulation data, worker, and ExcelJS bundles. These are pre-existing data-loading boundaries and are intentionally outside this UI migration.
- Some legacy tests remain source-contract checks. New behavior coverage was added for theme persistence, shell navigation, sidebar state, Dialog, Combobox, Select language updates, Number Field, and command-bar behavior; further test modernization can happen separately.
- Large page components still own substantial state. They are stable after migration, but future feature work may extract smaller domain components without changing the public route/store contracts.

### Blockers

- None.

### Follow-up cleanup

- Evaluate additional worker/data chunk splitting if startup performance becomes a separate objective.
- Continue replacing source-string assertions with rendered behavior tests as pages receive feature changes.
- Keep the migration document current for any post-release component additions; do not reintroduce legacy `.panel`, `.field-*`, or `.action-button-*` styling.

## Update Rules

- Only `pending`, `in_progress`, `completed`, and `blocked` are valid phase states.
- At most one phase may be `in_progress`.
- A phase becomes `completed` only after its completion gate passes and evidence is recorded above.
- Code changes and their migration-document status update belong in the same working change.
- Newly discovered follow-up work is recorded before moving to the next phase.
