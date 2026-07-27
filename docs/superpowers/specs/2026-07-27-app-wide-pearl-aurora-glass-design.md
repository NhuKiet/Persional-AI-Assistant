# App-wide Pearl Aurora Glass — Design

**Date:** 2026-07-27
**Status:** Visual direction approved; implementation pending
**Scope:** Frontend theme canvas, shared structural shells, Home action tiles, suggestion tiles, and shared chat composers.

## Context

The first Liquid Glass pass added a pastel background token to `body` and a translucent material to the shared composer. In the rendered app, the full-viewport `.app-layout` and several opaque page shells cover the body canvas. The Light composer therefore sits over a flat white surface and reads as a white capsule rather than glass. Dark uses a nearly uniform black canvas, so its composer reads as smoked plastic instead of the milky translucent material in the reference.

The approved revision is named **Pearl Aurora Glass**. It keeps the existing product layout and content hierarchy while making the atmospheric canvas visible across the application and extending the glass language to Home actions and suggestions.

## Goals

1. Make the atmospheric background continuous across the entire application, including the area behind the sidebar and page shells.
2. Make the shared composer visibly translucent in both Light and Dark themes.
3. Keep Dark theme unmistakably dark while adding enough subdued color variation for real backdrop blur and refraction.
4. Give Home action tiles and suggestion tiles a secondary Liquid Glass material.
5. Preserve all existing layout, behavior, accessibility, theme persistence, contextual accents, and responsive rules.

## Non-goals

- No navigation, content, or component hierarchy redesign.
- No bitmap or generated background asset.
- No continuous aurora animation.
- No glass treatment on every content surface. Dense working areas such as code, PDF pages, result text, menus, and message bubbles remain optimized for readability.
- No changes to chat sending, streaming, microphone, file upload, model selection, or keyboard behavior.

## Approved visual direction

### Shared canvas

The atmospheric canvas belongs to the application shell rather than only to `body`.

Light uses a pearl base with broad, low-contrast blue, yellow-green, and restrained violet glows. Dark uses a near-black blue base with substantially dimmer blue, teal, and violet glows. The glows are large enough that they read as atmosphere rather than colored circles.

The sidebar and top-level page shells allow this canvas to remain perceptible. They may use transparent or lightly frosted overlays where separation is necessary, but must not restore full-viewport opaque fills.

### Primary glass: composer

The composer is the strongest glass object in the hierarchy:

- translucent multi-layer fill;
- thin bright rim with stronger light on the upper edge;
- soft internal specular band across the upper portion;
- wide tinted shadow that samples the contextual accent;
- strong backdrop blur and saturation;
- sufficient fallback opacity when `backdrop-filter` is unavailable.

Light is clear pearl glass rather than an opaque white pill. Dark is milky charcoal glass rather than a black capsule. Both themes allow some background color to remain visible through the surface.

The send button remains the strongest accent. Attachment, microphone, and model controls use a quieter nested-glass treatment.

### Secondary glass: actions and suggestions

The six Home action tiles and four suggestion tiles use the same material family at reduced intensity:

- lower blur and shadow strength than the composer;
- thinner highlight and subtler rim;
- transparent layered fill that reveals the shared canvas;
- restrained one-pixel lift on hover;
- contextual cyan icon color retained;
- readable text contrast in both themes.

This creates a clear material hierarchy:

1. Composer — primary Liquid Glass.
2. Action and suggestion tiles — secondary Liquid Glass.
3. Structural shell and sidebar — ambient frost.
4. Dense content surfaces — readability-first existing surfaces.

## Theme behavior

Light remains the first-run default. A valid stored `light` or `dark` preference always wins.

Theme-specific canvas and material values are defined as CSS custom properties. Components consume semantic tokens instead of embedding theme colors. Contextual composer accents continue to flow through the existing accent contract.

## CSS architecture

Follow the existing import ownership:

- `frontend/src/styles/base.css`
  - Own app canvas, primary glass, secondary glass, rim, highlight, and shadow tokens.
  - Provide Light and Dark token values.
- `frontend/src/styles/coding.css`
  - Stop `.app-layout` from covering the shared canvas.
  - Keep structural contrast through tokenized transparent/frosted layers.
- `frontend/src/styles/sidebar.css`
  - Make the sidebar an ambient frosted layer over the shared canvas.
- `frontend/src/styles/chat.css`
  - Refine the shared composer material.
  - Apply secondary glass to Home action and suggestion tiles in the selectors owned by this file.
- Page-specific styles such as `pdf.css`, `research.css`, and tool styles
  - Remove only full-shell opaque backgrounds that block the canvas.
  - Keep dense content panels opaque or semi-opaque where readability requires it.
- `frontend/src/styles/responsive.css`
  - Add only breakpoint-specific material/layout corrections.

Do not change stylesheet import order, add `!important`, add a new stylesheet, or duplicate repeated visual values outside `base.css`.

## Interaction and motion

- Hover may animate color, border color, shadow, and `transform: translateY(-1px)`.
- Focus uses a visible accent-tinted ring without moving layout.
- Press may use a short, subtle scale or return-to-plane motion already supported by the app motion rules.
- Do not animate `filter` or `backdrop-filter`.
- Respect `prefers-reduced-motion`.
- Disabled states remain understandable without relying only on opacity or color.

## Accessibility and resilience

- Text and essential icons must meet WCAG AA contrast against their actual translucent backgrounds.
- Keyboard focus remains visible in both themes.
- Interactive hit targets and accessible names remain unchanged.
- Without `backdrop-filter`, the fallback fill must remain readable and visibly separated from the canvas.
- At 320px, tiles and composer controls must not clip or create horizontal overflow.

## Verification

### Automated

- Existing theme, InputBar, Home, navigation, and page tests continue to pass.
- Add or extend selector/class contract tests only where they protect shared ownership.
- Run frontend tests, typecheck, and production build.

### Visual

Verify at desktop and mobile widths:

- Home Light and Dark.
- Sidebar and main canvas continuity.
- Composer normal, hover/focus, disabled, and streaming states.
- Action tiles and suggestion tiles normal, hover, focus, and pressed states.
- Research, Coding, PDF, and at least one tool page to confirm the canvas is visible without reducing working-area readability.
- Model picker and other popovers are not clipped by glass containers.

## Acceptance criteria

- The background visibly spans the whole app rather than stopping behind an opaque `.app-layout`.
- Light composer clearly reads as transparent pearl glass.
- Dark composer reads as milky dark glass and visually matches the approved reference direction more closely.
- Home action and suggestion tiles use recognizable secondary Liquid Glass.
- Dark remains dark; ambient glows do not become decorative neon blobs.
- Dense content stays readable and existing behaviors do not regress.
