# Design System — Moon Post Service

Editorial brass-on-navy lithograph aesthetic. Late-19th-century periodical
feel: brass ink on midnight stock, Cormorant Garamond display, Satoshi UI.

All tokens live in `:root` in `styles.css`. New surfaces should consume
tokens — never hardcode hex values.

---

## Color

### Surface

| Token | Value | Use for |
|---|---|---|
| `--bg` | `#030A18` | Page background. The deep midnight everything sits on. |
| `--bg-2` | `#071327` | Slightly lifted surface (rarely needed). |
| `--panel` | `rgba(7, 15, 30, 0.72)` | Glass panel — cards, dropdowns, footers. |
| `--panel-strong` | `rgba(6, 12, 24, 0.88)` | Opaque panel — modals, key cards. |
| `--line` | `rgba(208, 180, 137, 0.46)` | Brass rule — primary divider, button borders. |
| `--line-soft` | `rgba(208, 180, 137, 0.20)` | Soft divider — between list rows, secondary. |

### Ink

| Token | Value | Use for |
|---|---|---|
| `--text` | `#EAD8BF` | Body copy. The default. |
| `--text-bright` | `#F0DFC2` | Headlines, emphasis, bubble content. |
| `--muted` | `rgba(234, 216, 191, 0.72)` | Secondary copy, subtitles. |
| `--muter` | `rgba(234, 216, 191, 0.46)` | Tertiary copy, timestamps, helper text. |

### Accent

| Token | Value | Use for |
|---|---|---|
| `--accent` | `#D4B58A` | Brass — uppercase labels, icons, primary fill. |
| `--accent-bright` | `#E5C9A0` | Brass on hover. |
| `--accent-deep` | `#C99D57` | Brass pressed / live indicator. |
| `--on-accent` | `#0A1422` | Dark ink on top of brass fills. |
| `--live` | `#D7B171` | Live indicator color. |
| `--live-dot` | `#C99D57` | Pulsing live dot. |

### Decision rules

- **Body text:** `--text`. **Headlines / emphasis:** `--text-bright`.
- **Labels (uppercase tracked):** `--accent`. Always.
- **Borders / rules:** `--line` for primary, `--line-soft` for secondary.
- **Interactive accent (links, icons):** `--accent`. On hover: `--accent-bright`.
- **Solid CTAs:** `--accent` background, `--on-accent` text.
- **Destructive copy** (delete, block): `#E89B73` warm amber. Not in tokens
  by design — destructive moments are explicit.

---

## Typography

Two families. Pick by role, not by aesthetic.

| Token | Family | Use for |
|---|---|---|
| `--serif` | Cormorant Garamond | Headlines, display, quotes, italic accents, body of editorial copy (philosophy, moon-reveal letter, chat bubbles, lunar notes). |
| `--sans` | Satoshi | UI controls, buttons, labels, timestamps, microcopy. |

### Type scale

| Token | Size | Use for |
|---|---|---|
| `--fs-display` | clamp(40px, 5.4vw, 76px) | Landing hero. |
| `--fs-h1` | clamp(38px, 5vw, 58px) | Section title. |
| `--fs-h2` | clamp(30px, 3.4vw, 44px) | Sub-section title. |
| `--fs-h3` | clamp(22px, 2vw, 28px) | Card title. |
| `--fs-lead` | clamp(17px, 1.6vw, 22px) | Hero subtitle, lead paragraph. |
| `--fs-body` | 15px | Default body. |
| `--fs-small` | 13px | Helper text, captions. |
| `--fs-caption` | 11px | Tracked uppercase labels. |

### Weights

- **Serif:** 400 for body, 500 for headings, 500 italic for emphasis.
  Never bold the serif. The form of Cormorant is the emphasis.
- **Sans:** 400 for body, 500 for emphasis, 600 for buttons / labels.

### Line heights

`--lh-tight: 1.05` (display), `--lh-snug: 1.2` (subheads), `--lh-body: 1.55` (paragraphs).

### Tracked labels

Uppercase microcopy ("MOONRISE", "LUNAR NOTE", "FROM"):

```css
font-family: var(--sans);
font-size: 11px;
font-weight: 600;
text-transform: uppercase;
letter-spacing: var(--tracking-label); /* 2.5px */
color: var(--accent);
```

This is the editorial "subtitle case" — used everywhere a small uppercase
label sits above content. Don't substitute serif here.

---

## Spacing

10-step scale. Pick by visual rhythm, not by pixel.

| Token | Value | Common use |
|---|---|---|
| `--space-1` | 4px | Adjacent inline elements. |
| `--space-2` | 8px | Default gap inside a control. |
| `--space-3` | 12px | Default gap between adjacent controls. |
| `--space-4` | 16px | Card inner padding (small). |
| `--space-5` | 24px | Card inner padding (default), modal padding. |
| `--space-6` | 32px | Section vertical rhythm. |
| `--space-7` | 40px | Hero vertical rhythm. |
| `--space-8` | 48px | Generous section padding. |
| `--space-9` | 56px | Page-level section block. |
| `--space-10` | 80px | Dramatic section break (philosophy page). |

---

## Radius

| Token | Value | Use for |
|---|---|---|
| `--radius-sm` | 8px | Inputs, small chips. |
| `--radius-md` | 16px | Cards, modals, message bubbles. |
| `--radius-lg` | 22px | Large hero cards (auth, reveal). |
| `--radius-pill` | 999px | Buttons, pills, badges. |

Buttons should always be `--radius-pill`. The pill shape is part of the system's voice.

---

## Shadow

| Token | Use for |
|---|---|
| `--shadow-sm` | Hover lift on small chips. |
| `--shadow-md` | Dropdowns, popovers. |
| `--shadow-lg` | Modal cards, hero panels. |
| `--shadow` | Alias for `--shadow-lg`. |

Brass-tinted glows (e.g., `0 0 24px rgba(212, 181, 138, 0.18)`) are inline,
not tokenized — they're scene-specific moments.

---

## Motion

| Token | Value | Use for |
|---|---|---|
| `--dur-fast` | 0.2s | Hover transitions, focus rings, color swaps. |
| `--dur-normal` | 0.4s | UI state changes (open/close). |
| `--dur-slow` | 0.9s | Editorial entrance animations (fadeInUp). |
| `--ease-out` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | Default easing. Fast-start, gentle settle. |

Always respect `prefers-reduced-motion` — animations are decorative.

---

## Components

### `.btn` — canonical button

Compose: `.btn` (base) + variant + optional size + optional modifier.

```html
<button class="btn btn--primary">Send</button>
<button class="btn btn--ghost">Cancel</button>
<button class="btn btn--link">Resend code</button>
<button class="btn btn--ghost btn--tracked btn--block">New Moon Message</button>
<button class="btn btn--primary btn--sm">Sign up</button>
```

| Variant | Look | Use for |
|---|---|---|
| `--primary` | Solid brass pill, dark ink. | The "do this" CTA. One per surface. |
| `--ghost` | Brass outline, transparent. | Secondary actions. |
| `--link` | Text-only, muted → brass on hover. | Tertiary ("Resend", "Change email"). |
| `--tracked` | Adds uppercase tracking. | Editorial pill labels. Stack with `--ghost`. |
| `--sm` / `--lg` | Size modifiers. | When the default doesn't fit. |
| `--block` | Full width. | Bottom-of-card primary CTAs. |

`disabled` and `aria-disabled="true"` both dim the button and disable
pointer events.

### Legacy button classes

These predate `.btn` and remain in place — same visual, just not composed:

- `.cta-button` — inbox "New Moon Message"
- `.cta-primary` — moon-reveal CTAs
- `.onboarding-primary` — auth flow
- `.location-detect-btn`, `.new-transmission-btn`, `.dropdown-btn`

For new code, prefer `.btn`. Migrating the legacy classes is a follow-up
cleanup, not a blocker.

---

## Surface inventory

All migrated to brass-on-navy. Quick reference for which file/lines to
look at when changing a surface:

| Surface | CSS | HTML |
|---|---|---|
| Landing | styles.css:7569+ | index.html:567+ |
| Auth / onboarding | styles.css:432–887 | index.html:451–565 |
| Philosophy page | styles.css:1415–1521 | index.html:1211–1263 |
| Moon-reveal page | styles.css:5108–5341 | index.html:1607–1683 |
| Shared sky | styles.css:1098–1285 | index.html:1112–1207 |
| Header + mobile menu | styles.css:7094–7228 | index.html:237–279 |
| Settings dropdown | styles.css:7282–7360 | index.html:282–406 |
| Inbox | styles.css:7393–7500 | index.html:982–1018 |
| Orbit + main | styles.css:7530–7700 | index.html:1024–1050 |
| Chat detail | styles.css:7752–8147 | index.html:1750+ |

---

## When in doubt

- **Need a color you don't see in a token?** You probably don't.
  Re-check `--text-bright`, `--accent`, `--muted` first.
- **Need a button?** Use `.btn`. Don't write a new `.foo-button` class.
- **Need a label-style microcopy?** Tracked sans-uppercase 11px brass.
- **Need a heading?** Cormorant 500. Italic for emphasis.
- **Need a body paragraph in long-form copy?** Cormorant 400.
- **Need UI text?** Satoshi.
- **Need a destructive action?** `#E89B73` text, `.btn--ghost` shape.
  Don't tokenize — destructive moments should be explicit.

---

## Adding a new surface

1. Use only tokens from `:root`. No new hex values.
2. Use `.btn` for buttons.
3. Use `var(--serif)` for editorial copy, `var(--sans)` for UI.
4. Use the spacing scale (`--space-*`) — not 7px, not 11px.
5. If you need to override a token at a scope (e.g., a special section),
   redefine it locally on the wrapper. Don't shadow `:root`.

If a surface needs something the system doesn't provide, that's a signal
to either (a) extend the tokens (rare) or (b) keep the one-off styling
local and document why.
