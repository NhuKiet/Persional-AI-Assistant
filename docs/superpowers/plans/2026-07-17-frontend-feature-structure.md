# Frontend Feature Structure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize `frontend/src` so every route feature owns its page, components, hooks, API types and styles while app composition and truly shared code have explicit homes.

**Architecture:** Move composition into `src/app`, route-owned code into `src/features/<feature>`, and code used by at least two features into `src/shared`. Preserve the current route table, lazy chunks, accessible DOM behavior and exact CSS cascade order.

**Tech Stack:** React 18, TypeScript 7, Vite 5, Vitest, Testing Library, hand-written CSS

## Global Constraints

- Before moving or editing CSS, read and follow `css-architecture`; use `ui-motion` only if any transition or animation behavior must change.
- Preserve routes `/`, `/chat`, `/research`, `/coding`, `/pdf` and `/tool/:toolId`.
- Keep Landing and Chat eager; keep Research, Coding, PDF and Tool Mode lazy.
- Do not rename CSS classes, component props, storage keys, SSE events or API payload fields.
- Preserve the exact current `styles.css` import order in the new app style entry.
- A feature may import `shared`; features must not import other features.

---

### Task 1: Lock frontend ownership boundaries

**Files:**
- Create: `frontend/src/test/project-structure.test.ts`

**Interfaces:**
- Consumes: `frontend/src` filesystem layout.
- Produces: a structural test preventing the old type-based top-level directories from returning.

- [ ] **Step 1: Write the failing structure test**

```ts
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const src = resolve(process.cwd(), "src");

describe("frontend project structure", () => {
  test("uses app, features and shared as source boundaries", () => {
    expect(existsSync(resolve(src, "app"))).toBe(true);
    expect(existsSync(resolve(src, "features"))).toBe(true);
    expect(existsSync(resolve(src, "shared"))).toBe(true);

    for (const legacy of ["pages", "components", "hooks", "lib", "pdf", "config", "styles"]) {
      expect(existsSync(resolve(src, legacy)), legacy).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run from `frontend/`: `npm.cmd run test -- src/test/project-structure.test.ts`

Expected: FAIL because `app`, `features`, and `shared` do not exist and legacy directories do.

- [ ] **Step 3: Commit the red test**

```powershell
git add frontend/src/test/project-structure.test.ts
git commit -m "test: require feature-first frontend structure"
```

### Task 2: Establish app composition and shared primitives

**Files:**
- Create: `frontend/src/app/App.tsx`
- Create: `frontend/src/app/router.tsx`
- Create: `frontend/src/shared/api/client.ts`, `frontend/src/shared/api/sse.ts`
- Move: reusable files from `frontend/src/components`, `hooks`, `lib`, `types.ts`, `ModelPicker.tsx`
- Modify: `frontend/src/main.tsx`
- Test: `frontend/src/test/app.smoke.test.jsx`, `frontend/src/test/routes.contract.test.jsx`

**Interfaces:**
- Consumes: current `AppRoutes`, `API`, `SESSION_ID`, SSE decoder, storage helpers and shared UI props.
- Produces: `App`, `AppRoutes`, `API`, `SESSION_ID`, `readSse`, shared components/hooks/types.

- [ ] **Step 1: Create target directories and move shared files**

```powershell
New-Item -ItemType Directory -Force frontend/src/app,frontend/src/shared/api,frontend/src/shared/components,frontend/src/shared/hooks,frontend/src/shared/lib,frontend/src/shared/types | Out-Null
git mv frontend/src/components/CodeBlock.tsx frontend/src/shared/components/CodeBlock.tsx
git mv frontend/src/components/ErrorBoundary.tsx frontend/src/shared/components/ErrorBoundary.tsx
git mv frontend/src/components/InputBar.tsx frontend/src/shared/components/InputBar.tsx
git mv frontend/src/components/Markdown.tsx frontend/src/shared/components/Markdown.tsx
git mv frontend/src/components/Message.tsx frontend/src/shared/components/Message.tsx
git mv frontend/src/components/Sidebar.tsx frontend/src/shared/components/Sidebar.tsx
git mv frontend/src/components/ToolDock.tsx frontend/src/shared/components/ToolDock.tsx
git mv frontend/src/ModelPicker.tsx frontend/src/shared/components/ModelPicker.tsx
git mv frontend/src/hooks/useChatHistory.ts frontend/src/shared/hooks/useChatHistory.ts
git mv frontend/src/hooks/useDragResize.ts frontend/src/shared/hooks/useDragResize.ts
git mv frontend/src/lib/storage.ts frontend/src/shared/lib/storage.ts
```

- [ ] **Step 2: Split API transport from feature hooks**

Move the existing `API` and `SESSION_ID` exports from `frontend/src/lib/api.ts` to `frontend/src/shared/api/client.ts`:

```ts
const env = import.meta.env as Record<string, string | undefined>;
export const API = env.VITE_API_URL ?? "http://localhost:8000";

export const SESSION_ID = (): string => Math.random().toString(36).slice(2);
```

Move the existing carry-buffer SSE decoder used by hooks into `frontend/src/shared/api/sse.ts` with this public interface:

```ts
export async function readSse(
  response: Response,
  onEvent: (event: unknown) => void,
  signal?: AbortSignal,
): Promise<void>;
```

The implementation must retain incomplete lines between streamed chunks and parse only `data:` lines. It must not interpret feature event types.

- [ ] **Step 3: Move shared types without changing their names**

Create `frontend/src/shared/types/model.ts` exporting the current `ModelSelection`; create `frontend/src/shared/types/chat.ts` exporting the current `Message`/`ChatMessage` types. Update consumers to import these exact symbols from `shared/types`.

- [ ] **Step 4: Split current App composition**

Move `PageLoading`, `guarded`, `withBack`, lazy imports, `ToolRoute` and `AppRoutes` from `frontend/src/App.tsx` to `frontend/src/app/router.tsx`. Create `frontend/src/app/App.tsx`:

```tsx
import { BrowserRouter } from "react-router-dom";
import { AppRoutes } from "./router";
import "../styles.css";

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
```

Update `frontend/src/main.tsx` to import `App` from `./app/App`.

- [ ] **Step 5: Run route and type checks**

Run from `frontend/`:

```powershell
npm.cmd run typecheck
npm.cmd run test -- src/test/app.smoke.test.jsx src/test/routes.contract.test.jsx
```

Expected: both commands exit 0; current route behavior remains unchanged.

- [ ] **Step 6: Commit app/shared boundaries**

```powershell
git add frontend/src/app frontend/src/shared frontend/src/main.tsx frontend/src/App.tsx frontend/src/components frontend/src/hooks frontend/src/lib frontend/src/types.ts frontend/src/ModelPicker.tsx
git commit -m "refactor: establish frontend app and shared boundaries"
```

### Task 3: Move Landing, Chat and Tool Mode by route ownership

**Files:**
- Create: `frontend/src/features/landing/`, `frontend/src/features/chat/`, `frontend/src/features/tool-mode/`
- Move: `LandingPage.tsx`, `HomePage.tsx`, `ToolPage.tsx`, `useChat.ts`, `config/tools.ts`, relevant styles
- Modify: `frontend/src/app/router.tsx`
- Test: existing route contract and smoke tests

**Interfaces:**
- Consumes: shared components, storage, model types, API/SSE transport.
- Produces: `LandingPage`, `HomePage`, `ToolPage`, `useChat`, `TOOLS` from route-owned packages.

- [ ] **Step 1: Create feature directories and move source**

```powershell
New-Item -ItemType Directory -Force frontend/src/features/landing,frontend/src/features/chat,frontend/src/features/tool-mode | Out-Null
git mv frontend/src/pages/LandingPage.tsx frontend/src/features/landing/LandingPage.tsx
git mv frontend/src/pages/HomePage.tsx frontend/src/features/chat/HomePage.tsx
git mv frontend/src/hooks/useChat.ts frontend/src/features/chat/useChat.ts
git mv frontend/src/pages/ToolPage.tsx frontend/src/features/tool-mode/ToolPage.tsx
git mv frontend/src/config/tools.ts frontend/src/features/tool-mode/tools.ts
```

- [ ] **Step 2: Update imports using the ownership rule**

`frontend/src/app/router.tsx` imports Landing and Chat eagerly:

```tsx
import { HomePage } from "../features/chat/HomePage";
import { LandingPage } from "../features/landing/LandingPage";
import { TOOLS } from "../features/tool-mode/tools";

const ToolPage = lazy(() =>
  import("../features/tool-mode/ToolPage").then((module) => ({ default: module.ToolPage })),
);
```

Feature files import shared code only through `../../shared/...`; Tool Mode must not import Chat internals.

- [ ] **Step 3: Preserve route behavior**

Run from `frontend/`: `npm.cmd run test -- src/test/app.smoke.test.jsx src/test/routes.contract.test.jsx`

Expected: PASS for `/`, `/chat`, `/tool/:toolId`, invalid tool redirect and back navigation.

- [ ] **Step 4: Run typecheck**

Run: `npm.cmd run typecheck`

Expected: exit 0.

- [ ] **Step 5: Commit the first route features**

```powershell
git add frontend/src/app frontend/src/features/landing frontend/src/features/chat frontend/src/features/tool-mode frontend/src/pages frontend/src/hooks frontend/src/config
git commit -m "refactor: organize landing and chat features"
```

### Task 4: Move Research, Coding and PDF as self-contained features

**Files:**
- Create: `frontend/src/features/research/`, `frontend/src/features/coding/`, `frontend/src/features/pdf/`
- Move: current route pages, feature components and hooks
- Modify: `frontend/src/app/router.tsx`
- Test: feature and route tests

**Interfaces:**
- Consumes: shared API/SSE transport, shared components/hooks/types.
- Produces: lazy route entry points `ResearchPage`, `CodingPage`, `PDFPage`.

- [ ] **Step 1: Move Research ownership**

```powershell
New-Item -ItemType Directory -Force frontend/src/features/research/components | Out-Null
git mv frontend/src/pages/ResearchPage.tsx frontend/src/features/research/ResearchPage.tsx
git mv frontend/src/hooks/useResearch.ts frontend/src/features/research/useResearch.ts
git mv frontend/src/components/research/* frontend/src/features/research/components/
```

Update local Research imports to `./components/...`; shared imports use `../../shared/...`.

- [ ] **Step 2: Move Coding ownership**

```powershell
New-Item -ItemType Directory -Force frontend/src/features/coding/components | Out-Null
git mv frontend/src/pages/CodingPage.tsx frontend/src/features/coding/CodingPage.tsx
git mv frontend/src/hooks/useCoding.ts frontend/src/features/coding/useCoding.ts
git mv frontend/src/components/coding/* frontend/src/features/coding/components/
```

- [ ] **Step 3: Move PDF ownership**

```powershell
New-Item -ItemType Directory -Force frontend/src/features/pdf/components | Out-Null
git mv frontend/src/pages/PdfPage.tsx frontend/src/features/pdf/PdfPage.tsx
git mv frontend/src/pdf/* frontend/src/features/pdf/components/
git mv frontend/src/test/SelectionLayer.test.jsx frontend/src/features/pdf/components/SelectionLayer.test.jsx
```

PDF keeps `react-pdf` imports inside the PDF feature so the dependency remains in its lazy chunk.

- [ ] **Step 4: Point lazy routes to feature entry files**

Use these imports in `frontend/src/app/router.tsx`:

```tsx
const ResearchPage = lazy(() => import("../features/research/ResearchPage").then(m => ({ default: m.ResearchPage })));
const CodingPage = lazy(() => import("../features/coding/CodingPage").then(m => ({ default: m.CodingPage })));
const PDFPage = lazy(() => import("../features/pdf/PdfPage").then(m => ({ default: m.PDFPage })));
```

- [ ] **Step 5: Run focused feature tests and typecheck**

Run from `frontend/`:

```powershell
npm.cmd run typecheck
npm.cmd run test -- src/features/research/components/ResearchResult.test.tsx src/features/pdf/components/SelectionLayer.test.jsx src/test/routes.contract.test.jsx
```

Expected: all checks pass.

- [ ] **Step 6: Commit heavy feature moves**

```powershell
git add frontend/src/app frontend/src/features/research frontend/src/features/coding frontend/src/features/pdf frontend/src/pages frontend/src/components frontend/src/hooks frontend/src/pdf frontend/src/test
git commit -m "refactor: organize research coding and pdf features"
```

### Task 5: Move styles without changing the cascade

**Files:**
- Create: `frontend/src/app/styles/index.css`
- Create: feature/shared style directories
- Move: every file in `frontend/src/styles/`
- Delete: `frontend/src/styles.css`, empty `frontend/src/styles/`
- Test: frontend route tests and production build

**Interfaces:**
- Consumes: current ordered list of 14 CSS imports.
- Produces: one global entry imported only by `app/App.tsx`.

- [ ] **Step 1: Move styles by ownership**

```powershell
New-Item -ItemType Directory -Force frontend/src/app/styles,frontend/src/shared/styles,frontend/src/features/landing/styles,frontend/src/features/chat/styles,frontend/src/features/research/styles,frontend/src/features/coding/styles,frontend/src/features/pdf/styles | Out-Null
git mv frontend/src/styles/base.css frontend/src/shared/styles/base.css
git mv frontend/src/styles/sidebar.css frontend/src/shared/styles/sidebar.css
git mv frontend/src/styles/scrollbar.css frontend/src/shared/styles/scrollbar.css
git mv frontend/src/styles/responsive.css frontend/src/shared/styles/responsive.css
git mv frontend/src/styles/chat.css frontend/src/features/chat/styles/chat.css
git mv frontend/src/styles/agent-chat.css frontend/src/features/chat/styles/agent-chat.css
git mv frontend/src/styles/landing.css frontend/src/features/landing/styles/landing.css
git mv frontend/src/styles/research.css frontend/src/features/research/styles/research.css
git mv frontend/src/styles/deepdive.css frontend/src/features/research/styles/deepdive.css
git mv frontend/src/styles/coding.css frontend/src/features/coding/styles/coding.css
git mv frontend/src/styles/artifact.css frontend/src/features/coding/styles/artifact.css
git mv frontend/src/styles/coding-v2.css frontend/src/features/coding/styles/coding-v2.css
git mv frontend/src/styles/pdf.css frontend/src/features/pdf/styles/pdf.css
git mv frontend/src/styles/pdf-select.css frontend/src/features/pdf/styles/pdf-select.css
```

- [ ] **Step 2: Recreate the exact cascade in `app/styles/index.css`**

```css
@import "../../shared/styles/base.css";
@import "../../features/chat/styles/chat.css";
@import "../../features/research/styles/research.css";
@import "../../features/coding/styles/coding.css";
@import "../../shared/styles/sidebar.css";
@import "../../features/coding/styles/artifact.css";
@import "../../features/pdf/styles/pdf.css";
@import "../../shared/styles/scrollbar.css";
@import "../../shared/styles/responsive.css";
@import "../../features/coding/styles/coding-v2.css";
@import "../../features/research/styles/deepdive.css";
@import "../../features/chat/styles/agent-chat.css";
@import "../../features/pdf/styles/pdf-select.css";
@import "../../features/landing/styles/landing.css";
```

- [ ] **Step 3: Point App at the new entry and delete the old entry**

Change the style import in `frontend/src/app/App.tsx` to:

```tsx
import "./styles/index.css";
```

Run: `git rm frontend/src/styles.css`

The only `url(...)` values in `base.css` are an absolute Google Fonts URL and an inline data URI, so no asset path rewrite is required.

- [ ] **Step 4: Run frontend verification**

Run from `frontend/`:

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

Expected: all commands exit 0; build output still contains separate lazy chunks for Research, Coding and PDF.

- [ ] **Step 5: Commit the style move**

```powershell
git add frontend/src/app frontend/src/shared/styles frontend/src/features frontend/src/styles frontend/src/styles.css
git commit -m "refactor: colocate frontend styles by feature"
```

### Task 6: Remove legacy frontend directories and verify boundaries

**Files:**
- Delete if empty: `frontend/src/pages/`, `components/`, `hooks/`, `lib/`, `pdf/`, `config/`, `styles/`
- Test: `frontend/src/test/project-structure.test.ts`

**Interfaces:**
- Consumes: final `app/features/shared` tree.
- Produces: feature-first frontend with a passing structural gate.

- [ ] **Step 1: Scan for old import paths**

Run from repository root:

```powershell
rg -n 'src/(pages|components|hooks|lib|pdf|config|styles)|["'']\.\.?/(pages|components|hooks|lib|pdf|config|styles)/' frontend/src
```

Expected: no matches.

- [ ] **Step 2: Run the structure test**

Run from `frontend/`: `npm.cmd run test -- src/test/project-structure.test.ts`

Expected: PASS.

- [ ] **Step 3: Run the complete frontend gate**

Run:

```powershell
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

Expected: all commands exit 0.
