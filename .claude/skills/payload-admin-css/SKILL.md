# Payload Admin Panel & Custom UI

Use this skill when working on the visual layer of this Payload CMS project: customizing admin panel pages, building custom admin views/shells, styling components with SCSS or CSS, using the organism component, or referencing the project's design system, domain glossary, or CSS paradigm. Also use when troubleshooting style conflicts between custom UI and Payload defaults.

## CSS Architecture — How Payload Styles Work

### CSS Layers (Specificity System)

Payload declares two CSS layers at the top of its stylesheet:

```css
@layer payload-default, payload;
```

**All internal Payload CSS lives inside `@layer payload-default`.** This means:

- Any **unlayered CSS** (the default for anything you write in `custom.scss` or component SCSS files) automatically has **higher specificity** than all of Payload's styles. You do NOT need `!important` to override Payload defaults.
- Use `@layer payload` if you want your custom styles to participate in the layer system but still beat `payload-default`.
- Use `@layer payload-default { ... }` only when you want your styles to compete at the **same** specificity level as Payload's built-in styles (rare — mainly for surgical overrides where you want Payload's own cascade rules to still apply).

**Rule: Never use `!important` unless fixing a third-party conflict. Payload's layer system makes it unnecessary.**

### Where to Put Styles

| Scope | File | When to use |
|---|---|---|
| Global admin overrides | `src/app/(payload)/custom.scss` | CSS variable theming, font changes, hiding/repositioning Payload chrome, global layout tweaks |
| Custom component styles | `src/components/admin/**/styles/*.scss` imported into the component | Styles for your own React components. Import directly in the component file. |
| Collection-specific view overrides | Component-level SCSS scoped with `:has([data-*])` selectors | Reshaping a specific collection's edit/list view without affecting others |

**Rule: Component styles go in component files, NOT in `custom.scss`. Keep `custom.scss` for truly global changes (variables, fonts, broad chrome overrides).**

### SCSS Utilities You Can Import

```scss
@import '@payloadcms/ui/scss';
```

This gives you access to:

**Mixins:**
- `@include extra-small-break { }` — `max-width: 400px`
- `@include small-break { }` — `max-width: 768px`
- `@include mid-break { }` — `max-width: 1024px`
- `@include large-break { }` — `max-width: 1440px`
- `@include formInput()` — Full form input styling (borders, shadows, focus states)
- `@include shadow-sm` / `shadow-m` / `shadow-lg` / `shadow-lg-top`
- `@include inputShadow` — Input hover shadow
- `@include blur-bg($color, $opacity)` — Frosted glass effect
- `@include readOnly` — Read-only field appearance
- `@include lightInputError` / `darkInputError` — Error state input styling

**Functions:**
- `base($multiplier)` — Returns `$baseline-px * $multiplier` (default baseline is 20px). E.g., `base(1)` = 20px, `base(0.5)` = 10px.

**Placeholders (extend only):**
- `%body`, `%h1` through `%h6` — Typography presets

**Important: Use `@import '@payloadcms/ui/scss'` (no tilde prefix). The `~` prefix is deprecated and breaks with Turbopack.**

## CSS Variables Reference — The Complete List

These are the ONLY styling knobs you can turn. Override them in `custom.scss` or component SCSS.

### Base Colors (raw palette, theme-unaware)

```
--color-base-0       rgb(255,255,255)   white
--color-base-50      rgb(245,245,245)
--color-base-100     rgb(235,235,235)
  ...increments of 50 through...
--color-base-950     rgb(7,7,7)
--color-base-1000    rgb(0,0,0)         black
```

Status palettes follow the same 50→950 scale:
- `--color-success-*` (blues/teals)
- `--color-error-*` (reds)
- `--color-warning-*` (oranges/ambers)
- `--color-blue-*` (same as success by default)

### Theme Elevation (auto-adapts to dark mode)

```
--theme-elevation-0     Background (white in light, dark gray in dark)
--theme-elevation-50    Subtle surface
--theme-elevation-100   Borders, dividers
--theme-elevation-150   Border color (--theme-border-color aliases this)
  ...increments of 50 through...
--theme-elevation-800   Primary text (light mode)
--theme-elevation-1000  Maximum contrast text (dark mode)
```

**How dark mode works:** In `html[data-theme='dark']`, elevation values are **inverted**: `--theme-elevation-0` maps to `--color-base-900`, `--theme-elevation-900` maps to `--color-base-0`, etc. This means "elevation-0 = background" and "elevation-800 = text" regardless of theme.

Theme status colors (`--theme-success-*`, `--theme-error-*`, `--theme-warning-*`) also auto-invert in dark mode.

### Core Theme Variables

```
--theme-bg            Background color (aliases --theme-elevation-0)
--theme-text          Primary text (elevation-800 light, elevation-1000 dark)
--theme-input-bg      Form input background (elevation-0 light, elevation-50 dark)
--theme-overlay       Modal overlay (rgba(5,5,5,0.5) light, 0.75 dark)
--theme-border-color  Default border (aliases --theme-elevation-150)
```

### Typography

```
--font-body    -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...
--font-serif   'Georgia', 'Bitstream Charter', ...
--font-mono    'SF Mono', Menlo, Consolas, Monaco, monospace
```

### Sizing & Spacing

```
--base-px              20        (unitless, used in calc)
--base-body-size       13        (unitless, used in calc)
--base                 calc((var(--base-px) / var(--base-body-size)) * 1rem)
                       ≈ 1.538rem at default settings

--gutter-h             base(3) = 60px (base(2) at mid-break, base(0.8) at small-break)
--spacing-view-bottom  var(--gutter-h)
```

### Layout

```
--app-header-height    calc(var(--base) * 2.8)
--doc-controls-height  calc(var(--base) * 2.8)
--nav-width            275px (100vw at small-break)
--nav-trans-time       150ms
--scrollbar-width      17px
```

### Border Radii

```
--style-radius-s       3px
--style-radius-m       4px
--style-radius-l       8px
```

### Z-Index

```
--z-nav     20
--z-modal   30
--z-status  40
--z-popup   60   (intentionally > modal so popups render above modals)
```

### Breakpoint Values (CSS vars, read-only reference)

```
--breakpoint-xs-width  400px
--breakpoint-s-width   768px
--breakpoint-m-width   1024px
--breakpoint-l-width   1440px
```

### Accessibility

```
--accessibility-outline         2px solid var(--theme-text)
--accessibility-outline-offset  2px
```

## SCSS Variables — NOT Overridable

**Critical: These SCSS variables are compiled INTO the shipped CSS. You cannot override them at runtime.** They exist in `@payloadcms/ui/scss` for use in your own SCSS files, but changing their values does NOT affect Payload's built-in styles.

```scss
$baseline-px: 20px;
$baseline-body-size: 13px;
$breakpoint-xs-width: 400px;
$breakpoint-s-width: 768px;
$breakpoint-m-width: 1024px;
$breakpoint-l-width: 1440px;
$style-radius-s: 3px;
$style-radius-m: 4px;
$style-radius-l: 8px;
```

If you need to change baseline sizing globally, override the CSS variables `--base-px` and `--base-body-size` in `:root`, NOT the SCSS variables. Elements using `var(--base)` will respond; elements using the compiled `base()` function output will not.

## Dark Mode

**Payload uses `html[data-theme='dark']`, NOT the `.dark` class.**

When writing dark-mode-aware styles:

```scss
// ✅ CORRECT
html[data-theme='dark'] .my-component {
  background: var(--theme-elevation-100);
}

// ❌ WRONG — Payload does not use .dark
.dark .my-component {
  background: var(--theme-elevation-100);
}
```

**Best practice: Use `--theme-elevation-*` and `--theme-*` variables instead of hardcoded colors whenever possible. They auto-adapt to dark mode.** Only use hardcoded colors (oklch, rgb, hex) for custom brand colors that should remain constant across themes, or when building completely custom UI that doesn't participate in Payload's theme system.

When you DO use hardcoded colors, provide both light and dark variants:

```scss
.my-badge {
  background: oklch(0.25 0 0 / 0.7);
  color: oklch(0.85 0 0);
}

html[data-theme='light'] .my-badge {
  background: oklch(0.9 0 0 / 0.7);
  color: oklch(0.2 0 0);
}
```

## BEM Class Naming & DOM Structure

Payload uses [BEM (Block Element Modifier)](http://getbem.com) throughout. Class names are stable and globally accessible.

### Key DOM Structure (Edit View)

```
div.template-default__wrap
  .app-header                              ← Top header bar
  main.collection-edit                     ← Main content area
    form.collection-edit__form
      .doc-controls                        ← Save button, timestamps
      .step-nav                            ← Breadcrumb navigation
      .leave-without-saving                ← Unsaved changes modal
      .collection-edit__main-wrapper
        .collection-edit__main
          .document-fields
            .document-fields__main
              .gutter.document-fields__edit
                .document-fields__fields
                  .field-type              ← Individual field wrappers
                    .field-type__wrap
            .document-fields__sidebar-wrap  ← Right sidebar
              .document-fields__sidebar
                .document-fields__sidebar-fields
```

### Key BEM Blocks

| Block | Description | Common Modifiers |
|---|---|---|
| `.template-default` | Page wrapper | `__wrap` |
| `.app-header` | Top navigation bar | — |
| `.collection-edit` | Edit view container | `__form`, `__main`, `__main-wrapper` |
| `.collection-list` | List view container | — |
| `.document-fields` | Fields wrapper | `__main`, `__sidebar-wrap`, `__sidebar`, `__fields`, `__edit` |
| `.field-type` | Field wrapper | `.text`, `.select`, `.relationship`, `.array`, `.upload`, `.group`, `.tabs`, `.blocks`, `.row`, `.collapsible`, `.json`, `.richText`, `.number`, `.email`, `.textarea`, `.date`, `.checkbox`, `.radio`, `.point`, `.code`, `.ui` |
| `.doc-controls` | Save/action bar | `__wrapper` |
| `.step-nav` | Breadcrumb | `__step` |
| `.btn` | Button | `--style-primary`, `--style-secondary`, `--style-pill`, `--size-small`, `--size-medium`, `--size-large`, `--icon-style-*`, `--disabled` |
| `.table` | Data table | `--appearance-default`, `--appearance-condensed` |
| `.nav` | Sidebar navigation | `__brand`, `__links` |
| `.gutter` | Content gutter | — |
| `.dashboard` | Dashboard view | — |

### Targeting Specific Collections or Views

Use Payload's data attributes or `:has()` selectors:

```scss
// Target a specific collection's edit view using :has() with a data attribute
// on your custom component
main.collection-edit:has([data-my-collection]) {
  // styles only for this collection
}

// Target the list view for all collections
.collection-list {
  // styles for list views
}

// Target a specific field type
.field-type.relationship {
  // styles for relationship fields
}
```

## Patterns — How to Do Common Things

### Override the Color Palette

```scss
// In custom.scss
:root {
  --color-base-0: #fafaf9;    // warm white
  --color-base-50: #f5f5f4;
  --color-base-900: #1c1917;  // warm black
  // ... full scale
}

html[data-theme='dark'] {
  // Dark mode elevations auto-invert, but you may want
  // to fine-tune specific theme vars:
  --theme-bg: #0a0a0a;
  --theme-text: #e5e5e5;
}
```

### Change Fonts

```scss
// In custom.scss
:root {
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}
```

### Hide Payload Chrome (Header, Breadcrumb, etc.)

```scss
// Conditionally hide using :has() scoping
.template-default__wrap:has([data-my-custom-view]) > .app-header {
  display: none;
}

.template-default__wrap:has([data-my-custom-view]) .step-nav {
  display: none;
}
```

### Flatten Payload DOM for Custom Grid Layouts

When building totally custom edit views, you need to flatten Payload's wrapper chain with `display: contents` so your custom grid items can participate in a parent grid:

```scss
main.collection-edit:has([data-my-view]) {
  display: grid;
  grid-template-columns: 1fr 300px;

  // Flatten ALL wrappers between main and your grid items
  & > .collection-edit__form { display: contents; }
  & .collection-edit__main-wrapper { display: contents; }
  & .collection-edit__main { display: contents; }
  & .document-fields { display: contents; }
  & .document-fields__main { display: contents; }
  & .document-fields__main > .gutter { display: contents; }
  & .document-fields__main .document-fields__fields { display: contents; }
}
```

### Scope Custom Component Styles with Data Attributes

Use `data-*` attributes on your custom component root, then scope all SCSS to that attribute. This is the safest pattern — zero collision risk:

```tsx
// Component
export function MyWidget() {
  return <div data-my-widget>...</div>
}
```

```scss
// Styles
[data-my-widget] {
  display: grid;
  gap: 0.5rem;
  background: var(--theme-elevation-50);
  border-radius: var(--style-radius-m);
}
```

### Override Payload Sidebar Styles (within a specific view)

```scss
main.collection-edit:has([data-my-view]) .document-fields__sidebar-wrap {
  // Reset Payload's absolute positioning
  position: static;
  width: auto;
  min-width: 0;
  height: auto;
}

main.collection-edit:has([data-my-view]) .document-fields__sidebar {
  position: static;
  width: auto;
  max-width: none;
  border: none;
  padding: 0.5rem;
  overflow-y: auto;
}
```

## Critical Pitfalls

### 1. Tailwind Conflicts

**Tailwind's `.table` utility class (`display: table`) conflicts with Payload's `.table` block class.** This breaks collection list views.

Fix: If using Tailwind in admin components:
- Do NOT add `@tailwind base` in `custom.scss` — it resets Payload styles.
- Scope Tailwind with a `.twp` wrapper class.
- Override the `.table` conflict explicitly:

```scss
// In custom.scss after tailwind utilities
.table.table--appearance-default > div:first-of-type {
  width: 100% !important;
}
```

Or better, use the scoped pattern from custom.scss:

```scss
@layer theme {
  @import 'tailwindcss/theme.css';
}

@layer base {
  .twp {
    @import 'tailwindcss/preflight.css';
  }

  .twp.no-twp {
    *, ::after, ::before, ::backdrop, ::file-selector-button {
      all: revert-layer;
    }
  }
}

@layer components;

@layer utilities {
  @import 'tailwindcss/utilities.css';
}
```

Then wrap Tailwind-using components with `className="twp"`.

### 2. SCSS Variables Are Pre-compiled

You CANNOT override `$baseline-px`, `$baseline-body-size`, or other SCSS variables by importing them before `@payloadcms/next/css`. The CSS ships pre-compiled. Override the CSS variable equivalents (`--base-px`, `--base-body-size`) instead.

### 3. Dark Mode Selector

Payload uses `html[data-theme='dark']`, not `.dark`. If using shadcn/ui or similar:

```scss
@custom-variant dark (&:is(.dark *, [data-theme='dark'] *));
```

### 4. Position: static Resets

Payload's sidebar uses `position: sticky/absolute` with hardcoded widths. If restructuring layouts, you MUST explicitly reset:

```scss
position: static;
width: auto;
min-width: 0;
height: auto;
```

### 5. Overflow Hidden Chains

When building custom views with constrained heights (e.g., full-viewport grids), you must set `min-height: 0` and `overflow: hidden` on every grid/flex item in the chain, or content will overflow its container. CSS Grid and Flexbox children default to `min-height: auto` which prevents shrinking below content size.

### 6. display: contents Breaks Some Properties

When flattening Payload's DOM with `display: contents`, the flattened element loses its own box — `background`, `border`, `padding`, `margin`, and `overflow` on that element are ignored. Only apply `display: contents` to wrapper elements you genuinely want to eliminate from the layout.

### 7. Import Map After Component Changes

After creating or modifying any component referenced in the Payload config, regenerate the import map:

```bash
npx payload generate:importmap
```

This runs automatically on dev server start and HMR, but you may need to manually trigger it after config changes.

## Design Philosophy — Separation, Not Modification

The core principle: **build custom UI as an isolated layer on top of Payload, never edit or tweak Payload's default components/layout.**

Payload's defaults are well-made and battle-tested. The strategy is:

1. **Payload handles Payload.** List views, auth, settings, nav, field rendering — leave these alone. They work. Don't inject custom CSS into them unless strictly necessary (e.g., hiding chrome in a custom view).
2. **Custom views are fully custom.** When you need a custom edit experience (like the Moments editor), build it as a self-contained component tree with its own SCSS, its own grid, its own tokens. Use `display: contents` to flatten Payload's wrappers and take over the layout, but don't try to style-patch Payload's field components into looking different.
3. **The boundary is the UI field.** Register a `type: 'ui'` field in the collection config. Its component is the entry point for your custom view. Everything inside that component is yours. Everything outside it (doc-controls, sidebar fields, nav) is Payload's.
4. **Scope aggressively.** Use `data-*` attributes and `:has()` selectors so your CSS only activates when your custom component is present. Payload's default views for other collections remain completely untouched.

```
┌─────────────────────────────────────────────┐
│  Payload Default Layer                      │
│  (nav, auth, list views, field rendering)   │
│  → Don't touch. Use as-is.                  │
│                                             │
│  ┌───────────────────────────────────────┐   │
│  │  Custom View Layer                   │   │
│  │  (your UI field components + SCSS)   │   │
│  │  → Fully owned. Own grid, own tokens.│   │
│  │  → Scoped via data-* + :has()       │   │
│  └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

**What this means in practice:**
- ✅ Build a `MomentShell` UI field that takes over the edit view with CSS Grid
- ✅ Use `display: contents` to flatten Payload wrappers so your grid items land correctly
- ✅ Hide Payload chrome (header, breadcrumb) scoped to your view via `:has([data-moment-shell])`
- ✅ Let Payload's sidebar fields render normally in their default style inside your grid's aside column
- ❌ Don't restyle Payload's `.field-type` wrappers, `.btn` styles, or `.table` appearance globally
- ❌ Don't override Payload's CSS variables in `custom.scss` unless you genuinely want the change everywhere
- ❌ Don't try to make Payload's default components "match" your design system — accept the boundary

## CSS Paradigm — Modern, Grid-First, Token-Driven

This project's CSS follows a distinct paradigm from Payload's defaults. Agents must understand and apply these principles when building custom UI:

### Units: Relative and Fractional

- **`vmin` / `vmax`** for spacing, gaps, padding, radii — viewport-relative so the UI scales proportionally across screen sizes without breakpoints.
- **`fr`** units for grid tracks — proportional sizing, never fixed pixel widths for layout columns/rows.
- **`rem` / `em`** for typography — relative to root/parent font size.
- **`dvh` / `dvw`** for viewport dimensions — dynamic viewport units that account for mobile browser chrome.
- **Never use `px` for layout dimensions.** Pixels are acceptable only for borders (`1px`), fine decorative details, and sub-pixel precision.

### Color: oklch Everywhere

All custom colors use the `oklch()` color space. This is non-negotiable for custom UI.

```css
/* oklch(lightness chroma hue / alpha) */
background: oklch(0.15 0 0);           /* neutral dark */
color: oklch(0.85 0 0);                /* neutral light text */
border: 1px solid oklch(0.25 0 0);     /* subtle border */
background: oklch(0.7 0.2 145);        /* vivid green */
background: oklch(0.5 0.15 250 / 0.8); /* translucent blue */
```

Why oklch:
- Perceptually uniform — `L=0.5` looks like 50% brightness for every hue.
- Decomposable — lightness, chroma, and hue are independent axes, making dynamic color systems trivial.
- The paint system (see Organism) passes `L`, `C`, `H` as separate CSS variables so they can be modulated independently per-position.

### Layout: CSS Grid as the Default

CSS Grid is the fundamental layout primitive. Apply `display: grid` to virtually every container. Use flexbox only for inline flows (badge rows, button groups, single-axis sequences).

```css
/* Every zone, section, panel, and frame is a grid */
[data-my-zone] {
  display: grid;
  grid-template-rows: 0.25fr 1fr 1fr;
  gap: 0.3vmin;
  min-height: 0;
  overflow: hidden;
}
```

Key patterns:
- **`grid-template-columns/rows` with `fr` units** — proportional tracks that breathe with the container.
- **`min-height: 0` on every grid/flex item** — prevents content overflow (CSS Grid default `min-height: auto` blocks shrinking).
- **`overflow: hidden`** on constrained containers — clip content that exceeds its track.
- **Grid template transitions** — animate `grid-template-columns` / `grid-template-rows` for smooth layout shifts (e.g., focus changes, aside toggle).

### Interaction: Keyboard-First

- **`tabIndex={0}`** on interactive containers — make them focusable.
- **Arrow keys / Tab** for navigation within organisms.
- **Keyboard shortcuts** for view-level actions (e.g., `Cmd+B` to toggle aside, `\` to toggle direction, `[`/`]` to warp).
- **Gamepad support** via polling loop — d-pad and stick input mapped to the same navigation actions.
- **Pointer drag with inertia** — touch/mouse drag triggers navigation with friction-based deceleration on release.
- All interaction modalities (keyboard, pointer, gamepad) funnel through the same store actions (`next`, `prev`, `jumpTo`, `shift`, `warpFirst`, `warpLast`).

### Data Attributes Over Classes

All custom component styling uses `data-*` attributes, never BEM classes. This creates zero collision risk with Payload and makes component state directly queryable in CSS:

```css
[data-cell]                              /* base cell */
[data-cell][data-position="0"]           /* focused cell */
[data-cell][data-position="1"]           /* 1 step from focus */
[data-cell][data-empty]                  /* placeholder cell */
[data-cell][data-media-type="video"]     /* video content */
[data-time][data-direction="x"]          /* horizontal layout */
[data-time][data-dragging]               /* during pointer drag */
[data-moment-shell][data-mode="edit"]    /* edit vs create mode */
[data-moment-shell][data-aside="closed"] /* aside collapsed */
```

**BEM vs data-* boundary:** These two naming systems operate in completely separate domains. Payload renders its own elements with BEM classes (`.collection-edit`, `.field-type`, `.btn`). You render your own elements with `data-*` attributes. They never share elements.

The only time you interact with Payload's BEM classes is when you **read** them in SCSS to target Payload's elements — flattening wrappers, hiding chrome, repositioning doc-controls. You never **write** BEM classes on your own elements.

```scss
// READ Payload's BEM classes to target their elements
main.collection-edit:has([data-moment-shell]) > .collection-edit__form {
  display: contents;
}

// WRITE data-* attributes on your own elements
[data-moment-shell] {
  display: grid;
}
```

**Rules:**
- Never add BEM classes to custom elements.
- Never add `data-*` attributes to Payload's elements.
- When targeting Payload DOM from your SCSS, always scope with `:has([data-your-component])` so the override only activates in your custom view.

## Domain Glossary

Fixed, shared vocabulary for agents working on this project. Use these terms exactly — do not invent synonyms.

### Organism (formerly "Time")

The **organism** is the headless, global layout primitive of our design system. It is a CSS Grid carousel that arranges a collection of **cells** along a single axis, with a focus-position system that scales track sizes so the focused cell dominates and edge cells recede.

The component is currently implemented as `<Time>` in `src/components/time/Time.tsx` and styled via `src/components/time/time.css`. The component and file names will be renamed from `Time`/`time` to `Organism`/`organism` as the semantic model solidifies.

**Core characteristics:**
- **Headless:** The organism has no opinion about what a cell looks like. It receives `items` and a `renderCell` callback. The cell's visual content is entirely the consumer's responsibility.
- **Focus-driven:** One cell is always the **focus**. Track sizes are computed from the `FR_SCALE` table based on distance from focus. Focus shifts via keyboard, pointer drag, or gamepad.
- **Kind-driven:** The organism has three kinds (see Kind below), not just two directions.
- **Token-driven:** All visual tuning (gap, padding, radius, animation timing, position-based lightness) is expressed as CSS custom properties on the `[data-organism]` root. Tokens can be overridden inline (dev panel), via parent context, or via CSS.
- **Progressive:** Large collections are chunked — only a window around the focus is mounted in the DOM.

**Key anatomy:**
- `[data-organism]` — the grid container (currently `[data-time]`)
- `[data-cell]` — each item in the grid
- `[data-cell-content]` — overlay content inside a cell
- `[data-position="N"]` — distance from focus (0 = focused, ±1/2/3 = adjacent)
- `[data-kind="x|y|z"]` — current kind (currently `[data-direction="x|y"]`)
- `[data-labeled]` — present when in documentation mode (currently not implemented)
- `[data-carousel]` — present when n > 7 (carousel mode vs fit mode)
- `[data-dragging]` — present during pointer drag

### Kind

The organism's layout mode. Three kinds exist, each with distinct cell count and sizing behavior:

| Kind | Axis | Cells | Sizing | Description |
|---|---|---|---|---|
| `x` | horizontal | 7 | symmetric widths, focus-weighted | Horizontal focal carousel |
| `y` | vertical | 7 | symmetric heights, focus-weighted | Vertical banding carousel |
| `z` | vertical | 3 | descending heights | Block hierarchy — NOT YET IMPLEMENTED |

Kind transitions are free — any kind can switch to any other kind at runtime. The current code implements `x` and `y` as a `direction` prop/toggle. `z` is spec'd in Figma but not yet built.

**Default kind is `z`** per the Figma spec (the current code defaults to `x` — this will change).

### Labeled

A boolean property on the organism. **NOT YET IMPLEMENTED.**

- `false` (default) — **Production mode.** Cells render without labels. This is the runtime/app experience.
- `true` — **Documentation mode.** Cells render with visible labels. Used for design documentation and dev tooling.

### Organism Lifecycle

The organism progresses through a lifecycle as it is configured and used. This lifecycle is defined in the Figma spec and will inform future API design:

1. **Instantiated** — Created with defaults (`Kind=z`, `Labeled=false`).
2. **Configured** — Any Kind selected, Labeled toggled. The organism is ready for use.
3. **In Use** — Splits into two terminal states:
   - **Production** (`Labeled=false`) — The organism in its runtime form.
   - **Documentation** (`Labeled=true`) — The organism in its documentation/inspection form.

The lifecycle is not tracked in code today. It describes the conceptual stages an organism instance moves through.

### Organism Tokens

CSS custom properties on the organism root that control its appearance. All use relative units.

The table below shows the **target names** (what the tokens will be called after the rename) and the **current names** in the code. When reading or writing code today, use the current names. The skill documents both so agents can map between spec and implementation.

| Target name | Current name in code | Default | Purpose |
|---|---|---|---|
| `--organism-duration` | `--time-duration` | `300ms` | Animation/transition timing |
| `--organism-easing` | `--time-easing` | `cubic-bezier(0.25, 1, 0.5, 1)` | Easing curve |
| `--organism-gap` | `--time-gap` | `0.9vmin` | Gap between tracks |
| `--organism-padding` | `--time-padding` | `0.9vmin` | Container padding |
| `--organism-radius` | `--time-radius` | `1.1vmin` | Container border-radius |
| `--cell-radius` | `--cell-radius` | `0.7vmin` | Cell border-radius |
| `--cell-l-base` | `--cell-l-base` | `0.15` | Base lightness for non-visible cells |
| `--cell-l-0` | `--cell-l-0` | `0.85` | Lightness scale at position 0 (focus) |
| `--cell-l-1` | `--cell-l-1` | `0.55` | Lightness scale at position ±1 |
| `--cell-l-2` | `--cell-l-2` | `0.35` | Lightness scale at position ±2 |
| `--cell-l-3` | `--cell-l-3` | `0.20` | Lightness scale at position ±3 |

### Cell

A single item inside an organism. The cell is a `<button>` (interactive) or `<div>` (static) with `data-cell`. It receives **paint** values from its parent context as CSS custom properties:

| Paint variable | Purpose |
|---|---|
| `--paint-l` | oklch lightness of the item's color |
| `--paint-c` | oklch chroma of the item's color |
| `--paint-h` | oklch hue of the item's color |
| `--paint-dim` | Lightness reduction on `:active` |
| `--paint-lit` | Lightness boost on `:hover` |

The cell's background color is computed as `oklch(var(--cell-l-computed) var(--paint-c) var(--paint-h))` where `--cell-l-computed` blends `--paint-l` with the position-based `--cell-l-scale`.

### Paint

The color identity of an item, decomposed into oklch components (`L`, `C`, `H`). Paint values flow from the data model (e.g., a Moment's `paintL/paintC/paintH` fields) into cells as inline CSS variables. This allows the organism to modulate lightness by position while preserving the item's chromatic identity.

### Moment

A content object in the CMS — a scheduled event or media collection with a time range, status, access level, media attachments, and paint color. The Moments collection has a custom admin edit view (`MomentShell`) that uses organisms for its media and memories panels.

### Memory

A content object linked to a Moment — an activity log entry, message, artifact, or system event. Memories are displayed in a vertical organism inside the Moments edit view.

### Navi

The bottom bar in a custom view. Spans the full width of the layout. Contains a dialogue string (status summary) and symbol indicators (colored dots showing system state). The navi is controlled by a Zustand store (`src/stores/navi.ts`).

### Shell

The top-level custom component registered as a UI field on a collection's edit view. The shell is the boundary between Payload's world and the custom view. It flattens Payload's DOM via CSS `display: contents` on wrapper elements and establishes a CSS Grid layout on the `main.collection-edit` element.

Example: `MomentShell` is the shell for the Moments collection edit view.

### Zone

A named region within a shell's grid layout. Each zone occupies specific grid tracks and may contain sub-grids, organisms, or other content. Zone naming follows the Figma spec.

Example zones in MomentShell: **Main** (metadata + media + memories), **Aside** (Payload sidebar fields + doc-controls), **Navi** (bottom bar).

## Organism Usage — How to Consume It

### Basic Usage

```tsx
import { Time } from '@/components/time/Time'
import { createTimeStore } from '@/stores/time'
import '@/components/time/time.css'

const myStore = useMemo(() => createTimeStore(), [])

<Time
  items={myItems}
  renderCell={(item, position, onSelect) => (
    <button
      data-cell=""
      data-position={position}
      type="button"
      onClick={onSelect}
      style={{
        '--paint-l': item.lightness,
        '--paint-c': item.chroma,
        '--paint-h': item.hue,
      } as React.CSSProperties}
    >
      <span data-cell-content="">{item.title}</span>
    </button>
  )}
  store={myStore}
  direction="x"
  initialFocusIndex={0}
/>
```

### Props

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| `items` | `T[]` | yes | — | The data array |
| `renderCell` | `(item: T, position: number, onSelect: () => void) => ReactNode` | yes | — | Cell renderer. `position` is distance from focus (0 = focused). |
| `keyExtractor` | `(item: T, index: number) => string \| number` | no | index | Stable key for each item |
| `store` | `TimeStore` | no | singleton | Zustand store instance. **Always create a scoped store** when using multiple organisms on one page. |
| `direction` | `'x' \| 'y'` | no | `'x'` | Initial axis |
| `initialFocusIndex` | `number` | no | `0` | Starting focus position |
| `useTokens` | `boolean` | no | `false` | Apply dev panel token overrides as inline styles (frontend only) |

### Store API

The organism's state is managed by a Zustand store (`createTimeStore()`). Actions:

| Action | Description |
|---|---|
| `init(itemCount, initialFocusIndex)` | Initialize. Called automatically on mount. |
| `jumpTo(index)` | Set focus to a specific index |
| `shift(delta)` | Move focus by delta (positive = forward) |
| `next()` / `prev()` | Move focus by ±1 |
| `warpFirst()` / `warpLast()` | Jump to first/last item |
| `toggleDirection()` | Swap x ↔ y axis |

### Styling an Organism Instance

Override tokens on the parent or via a wrapper:

```css
/* Compact organism in a sidebar */
[data-my-sidebar] [data-organism] {
  --organism-gap: 0.3vmin;
  --organism-padding: 0.3vmin;
  --organism-radius: 0.4vmin;
  --cell-radius: 0.3vmin;
}

/* Fullscreen organism */
[data-fullscreen] [data-organism] {
  --organism-gap: 1.2vmin;
  --organism-padding: 1.2vmin;
  --organism-radius: 0;
  width: 100vw;
  height: 100dvh;
}
```

## Project Conventions (This Codebase)

Based on existing patterns in `src/components/admin/`:

1. **SCSS files live in a `styles/` subdirectory** next to the component, or in a shared `styles/` for the view.
2. **Data attributes for scoping:** Components use `data-*` attributes (e.g., `data-moment-shell`, `data-metadata-strip`) rather than BEM classes for custom elements.
3. **Design tokens as CSS custom properties** on the scoping data-attribute element:
   ```scss
   [data-moment-shell] {
     --body-gap: 0.3vmin;
     --body-radius: 0.6vmin;
     --surface-body: oklch(0 0 0);
   }
   ```
4. **oklch color space** for custom brand colors. Use `oklch(lightness chroma hue / alpha)`.
5. **Payload theme variables** for anything that should respect the admin theme (borders, text, inputs, backgrounds).
6. **Responsive breakpoints** use plain `@media` queries or Payload's mixins.
7. **Layered override comments** document the DOM chain being targeted and why, using a numbered LAYER system for complex view overrides.
8. **Scoped Zustand stores** — each organism instance on a page gets its own store via `createTimeStore()`. Never share the singleton across multiple organisms.
9. **UI field as the boundary** — custom views enter Payload through a `type: 'ui'` field. The component registered on that field is the shell. Everything inside the shell follows our CSS paradigm. Everything outside follows Payload's.
