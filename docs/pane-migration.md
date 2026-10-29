# Pane migration: component and token map

Brick Forge moves from its own CSS (`src/styles.css`, 599 lines) to **Pane**
(`~/Downloads/ds/pilot-glass`, v0.3.0). Pane isn't on npm, so it installs from
the release tarball:

```
npm install ~/Downloads/ds/pilot-glass/release/pane-react-0.3.0.tgz
```

`import 'pane-react/all.css'` goes once in `main.tsx`. That file (78 KB) holds
only classes, `:root` variables and `@scope` theme blocks, with no element
resets, so it sits beside the current CSS and screens can move one at a time.

This file is the map. Migration follows it wave by wave (bottom of the page),
and every wave has to pass the frame-rate gate.

## Ground rules

- **Theme:** light (`<html data-theme="light">`). The 3D scene is a light grey
  table with a green baseplate, so everything sits on `<Environment brightness="bright">`.
- **Glass over a live 3D scene costs GPU.** Pane's panes blur what's behind
  them (64 px blur, 1.8 saturate), and here that is a WebGL canvas redrawn on
  every orbit frame. Panels over the canvas start as `material="solid"`. Glass
  is switched on only where the frame-rate gate passes. (Gate: orbiting the
  285-part W14 must hold the same frame time as before, measured on the
  user's Mac, not headless.)
- **Tokens, never raw values:** after migration `src/styles.css` holds only
  layout that Pane doesn't cover, written with `var(--ds-*)`.
- **@scope** (used for Pane's themes) needs Chromium 118+, Safari 17.4+, or a
  Firefox release recent enough to have it. Check the Firefox version before
  relying on it.

## Token map

Values counted from `src/styles.css`. Pane values are the light theme where it
overrides them.

### Colour

| Brick Forge now | uses | Pane token |
|---|---|---|
| `#1f6feb` (primary blue: buttons, active) | 45 | `--ds-action-accent` (`--ds-action-accent-hover` on hover) |
| `#fff` (panels, cards) | 39 | `--ds-card-bg` / `--ds-surface-glass` (solid: `--ds-surface-raised`) |
| `#e3e8ee` `#e8ecf1` `#dde2e8` `#dfe4ea` `#cfd6de` (borders) | 15 | `--ds-line-divider`; control outlines `--ds-line-ring` |
| `#eef1f5` `#f0f3f6` `#f6f8fa` `#f2f4f7` (quiet fills: stat cells, pills) | 16 | `--ds-surface-quiet`; inset wells `--ds-surface-well` |
| `#1c2430` `#3a4554` (text) | 12 | `--ds-text-primary` |
| `#6b7685` `#8a94a3` `#9aa3ae` `#a3abb6` `#4b5563` (muted text) | 24 | `--ds-text-secondary` |
| `#1a7f37` `#1d7a46` / `#e8f6ee` (ok, held ≥ 95 %) | 6 | `--ds-badge-positive-fg` / `--ds-badge-positive-bg` |
| `#f0b429` `#fffaf0` `#8a5a00` `#9a5b00` (warn, held < 95 %) | 10 | `--ds-badge-warning-fg` / `--ds-badge-warning-bg` |
| `#c8d9fb` `#eef4ff` `#f2f7ff` (selected tints) | 14 | `--ds-tabs-on-bg` / `--ds-tabs-on-fg` |
| `#6b4bf1` gradient (✦ Create, ✦ Generate) | 4 | no Pane token: the one brand gradient stays custom, from `--ds-action-accent` |

### Shape, type, space

| Brick Forge now | uses | Pane token |
|---|---|---|
| radius 8 px (buttons, inputs) | 24 | `--ds-button-radius` (Pane's control radius) |
| radius 14–16 px (cards, tiles) | 9 | `--ds-corner-media` (18 px) |
| side panels / dialogs | 4 | `--ds-corner-panel` (40 px): a visible change, decide on the pilot |
| radius 999 px / 50 % | 17 | `--ds-corner-round` |
| font 12 px | 26 | `--ds-type-caption` (13 px) |
| font 9–11 px | 17 | `--ds-type-micro` (11 px). 9–10 px rises to 11 for legibility |
| font 13–14 px | 7 | `--ds-type-caption` / `--ds-type-label` |
| font 16–22 px (titles) | 4 | `--ds-type-emphasis` (17) / `--ds-type-title` (21) |
| font 40 px | 1 | `--ds-type-display` (44) |
| gap 2 / 4 px | 21 | `--ds-gap-xs` (4) |
| gap 6 px | 20 | `--ds-gap-sm` |
| gap 8 px | 13 | `--ds-gap-md` |
| gap 10–12 px | 10 | `--ds-gap-lg` (12) |
| gap 14 / 16 / 24 / 32 px | — | `--ds-gap-xl` / `--ds-gap-2xl` / `--ds-gap-3xl` / `--ds-gap-section` |
| button height ~28–32 px | — | `--ds-control-sm` (32) / `--ds-control-md` (36) |
| shadows on cards and tiles | — | `--ds-elevation-lift`; floating panels `--ds-elevation-float` |
| font stack | — | `--ds-type-family` |

## Component map

Counts are from `src/App.tsx` and `src/ui/*.tsx` (2,462 lines).

| Brick Forge pattern | where | Pane |
|---|---|---|
| `.seg` single choice (Icon/3D, Trackpad/Mouse, Ideas sources, kinds, levels, size, New/LEGO sets) | 13 groups: App, Ideas, Studio, Learning | `Tabs.Root` + `Tabs.List` + `Tabs.Trigger` (no `Tabs.Content`; Radix gives roving focus). Levels and sizes `size` sm |
| `.chip` toggle (Technic) | Studio | `Chip selected onSelectedChange` |
| info pills on tiles (pieces, level) | Studio | `Tag` |
| held % pill (ok / warn) | Studio | `Badge tone="positive"` / `tone="warning"` |
| primary buttons (`.primary`, Build, Building instructions, Export) | ~10 | `Button variant="accent"` |
| secondary buttons (Steps, Clear, Undo, Redo) | ~40 | `Button variant="glass"` (a quiet fill), `size="sm"` in dense bars. Not `light`: in the light theme it inverts to a black button |
| icon-only (✕ close, ⋯ details, rotate, ↻) | ~12 | `IconButton aria-label=…` (`variant="ghost"` in toolbars) |
| ✦ Generate / ✦ Create | 2 | `Button variant="accent"` plus the custom brand gradient class |
| side panels `.card` (left library, right Model) | App | `Card variant="glass"` (start `solid`, see rules) |
| Ideas sheet `.ideas` | Ideas | `Card` + `Stack` |
| tiles `.tile`, `.idea` | Studio, Ideas | `Card` with `Card` cover for the picture; stats `Card variant="inset"` |
| "My pieces" checkbox | Studio | `Switch label="My pieces"` |
| range sliders (personality, pieces, instruction scrubber) | Ideas, Instructions | `Slider label format` |
| `<select>` | App, Ideas, Learning | `Select label options` |
| text and number inputs | Ideas, MyLibrary, Learning | `Input` inside `FormField` + `Label` (+ `HelperText`) |
| labels and help lines (`.muted.small`) | everywhere | `Label`, `HelperText`; free text uses `--ds-text-secondary` and `--ds-type-caption` |
| toast and status ("Not connected to anything") | App | `Banner tone` (warning / critical), `live="polite"` |
| status line and dock (bottom bar) | App | `Card` + `Stack direction="row"` of `Button` / `IconButton` |

### No Pane component yet: keep custom, styled with tokens

| pattern | why | until |
|---|---|---|
| tables (Model size, parts list, booklet) | Pane has no Table (wave 7, Data Display) | wave 7 |
| welcome dialog, instruction overlay | no Dialog / Sheet (wave 4, Overlays) | wave 4 |
| file input ("Open a model") | none | `Button` that opens a hidden `<input type=file>` |
| key caps (`.key`: R, X, S) | none | custom `<kbd>` on tokens |
| spinner / loading tiles | none in the components (there is a Loading pattern) | custom on tokens |
| tooltips (title attributes) | none | stay as `title` |

## Waves

Each wave ships on its own and passes the frame-rate gate first.

0. **Install:** install the tarball, import `pane-react/all.css`, add
   `data-theme="light"`, wrap the app in `<Environment brightness="bright">`.
   Nothing should look different yet. *Done.* `material="solid"` comes in 0.4.0 (still in
   Pane's working tree); until then `data-material="solid"` plus `src/pane-solid.css` applies
   the same D-021 values. Delete the shim when 0.4.0 is installed.
1. **Pilot, the Studio (Ideas → Builds):**
   - kinds, levels, size and New/LEGO sets become `Tabs`;
   - Technic becomes a `Chip`, "My pieces" a `Switch`;
   - tiles become `Card` with `Tag` / `Badge`, and Build / Steps / ⋯ become `Button` / `IconButton`.
   - Measure the frame rate, then decide glass vs solid and the panel corner radius.
   - *Done* (solid). Checked in the browser: no errors, tiles have no backdrop filter, every
     tab group keeps one active value (Technic clears the level tabs).
2. Ideas' other modes (voxel characters, shapes, photo, 3D model): `Slider`, `Select`, `Input`.
   *Done.* Every single-choice group goes through `src/ui/Choice.tsx` (Tabs without panels).
   Idea cards are `Card` like the Studio tiles; secondary buttons on them are `glass`, which
   needs the Card's tinted surface behind it (on plain white, light theme, it nearly vanishes).
3. Side panels and dock (`App.tsx`): `Card`, `Tabs`, `Button`, `Banner`.
4. Instructions: `Button`, `IconButton`, `Slider` scrubber. The overlay stays custom until Pane's Dialog ships.
5. My Library and Learning: `Input`, `FormField`, `Select`, `Button`.
6. Clean-up: delete the CSS each wave made unused, until `styles.css` is layout only.

Waves 3–6 *done* (2026-10-28): side panels, Ideas frame, welcome and the instruction
overlay's panels are `Card`; every single choice is `Choice` (Tabs); toggles (category,
Dimensions, Stability, X-ray, Steps) are `Chip`; inputs are `Input`, `Textarea`, `Select`,
`Switch`, `Slider`. `styles.css` was rewritten on `--ds-*` tokens: the only raw colour left
is `--brand-violet`, the far end of the ✦ gradient. Still custom (no Pane component):
part tiles, swatches, tables, key caps, the stepper, progress bars.

## Open questions for the user

- Glass or solid over the 3D scene, once the pilot's frame rate is measured.
- Pane's big panel corners (40 px) and type scale (body 15 px, against 12 px
  now): a visibly roomier look. Keep it as Pane designs it, or ask for a
  denser Pane variant for tool UIs?
- When Pane updates: re-pack (`pnpm run release:pack` in pilot-glass) and
  reinstall the tarball. The map above is against 0.3.0; check
  `CHANGELOG.md` for API changes before each wave.
