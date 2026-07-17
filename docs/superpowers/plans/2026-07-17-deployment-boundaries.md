# Deployment Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give backend and frontend independent dependency/build boundaries while keeping root Docker Compose, environment configuration and beginner-friendly commands.

**Architecture:** Move backend dependency and image files into `backend/`, use `backend` and `frontend` as separate Compose build contexts, and make CI run inside each application boundary. Add thin PowerShell orchestration scripts and update README only after verified commands pass.

**Tech Stack:** Docker, Docker Compose, GitHub Actions, Python 3.11, Node.js 20, PowerShell

## Global Constraints

- Execute this plan only after the backend cleanup and frontend feature-structure plans pass.
- Preserve root `.env`, `.env.example`, `docker-compose.yml`, `data/` and all environment variable names.
- Backend container command is `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
- Frontend remains exposed at host port 5173 and backend at host port 8000.
- Compose must keep `./data:/app/data` and `host.docker.internal` behavior.
- Do not add a second package manager, task runner or deployment platform.

---

### Task 1: Lock deployable application boundaries

**Files:**
- Create: `backend/tests/test_deployment_layout.py`

**Interfaces:**
- Consumes: repository, backend and frontend filesystem paths.
- Produces: a static gate for Dockerfile/dependency placement and root cleanliness.

- [ ] **Step 1: Write the failing deployment layout test**

```python
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_each_application_owns_its_build_files():
    assert (ROOT / "backend" / "Dockerfile").is_file()
    assert (ROOT / "backend" / "requirements.txt").is_file()
    assert (ROOT / "frontend" / "Dockerfile").is_file()
    assert not (ROOT / "Dockerfile").exists()
    assert not (ROOT / "requirements.txt").exists()
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `python -m pytest backend/tests/test_deployment_layout.py -q`

Expected: FAIL because backend build files still live at repository root.

- [ ] **Step 3: Commit the red test**

```powershell
git add backend/tests/test_deployment_layout.py
git commit -m "test: require per-application build boundaries"
```

### Task 2: Move backend dependencies and image definition

**Files:**
- Move: `requirements.txt` to `backend/requirements.txt`
- Move: `Dockerfile` to `backend/Dockerfile`
- Modify: `backend/Dockerfile`
- Keep: `Dockerfile.executor` at root because the Coding executor builds it independently
- Test: `backend/tests/test_deployment_layout.py`

**Interfaces:**
- Consumes: `backend/app`, `backend/requirements.txt`.
- Produces: backend image whose working directory contains package `app` and command `uvicorn app.main:app`.

- [ ] **Step 1: Move the backend build files**

```powershell
git mv requirements.txt backend/requirements.txt
git mv Dockerfile backend/Dockerfile
```

- [ ] **Step 2: Make `backend/Dockerfile` use the backend build context**

Use this complete file:

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:8000/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 3: Run the deployment layout test**

Run: `python -m pytest backend/tests/test_deployment_layout.py -q`

Expected: PASS.

- [ ] **Step 4: Verify local import from inside backend**

Run from `backend/`: `python -c "from app.main import app; print(app.title)"`

Expected: prints `KiNg AI Backend`.

- [ ] **Step 5: Commit backend build ownership**

```powershell
git add backend Dockerfile requirements.txt
git commit -m "build: move backend image and dependencies"
```

### Task 3: Point Compose at independent application contexts

**Files:**
- Modify: `docker-compose.yml`
- Test: rendered Compose configuration

**Interfaces:**
- Consumes: `backend/Dockerfile`, `frontend/Dockerfile`, root `.env`, root `data/`.
- Produces: `backend` and `frontend` services with independent contexts.

- [ ] **Step 1: Update backend build configuration**

Replace the backend build line with:

```yaml
services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
```

Keep the existing ports, `env_file`, `OLLAMA_URL`, `extra_hosts`, volume and restart values exactly unchanged.

- [ ] **Step 2: Keep the frontend build boundary explicit**

The frontend block must retain:

```yaml
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
      args:
        VITE_API_URL: http://localhost:8000
```

- [ ] **Step 3: Render and inspect Compose configuration**

Run: `docker compose config`

Expected: exit 0; backend context resolves to `backend`, frontend context resolves to `frontend`, and volume source resolves to root `data`.

- [ ] **Step 4: Build both application images**

Run: `docker compose build backend frontend`

Expected: both images build successfully; backend reaches its `CMD` layer and frontend completes the Vite production build.

- [ ] **Step 5: Commit Compose changes**

```powershell
git add docker-compose.yml
git commit -m "build: use independent app contexts"
```

### Task 4: Align GitHub Actions with application boundaries

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `backend/requirements.txt`, `backend/tests`, `frontend/package-lock.json`.
- Produces: independent backend and frontend CI jobs.

- [ ] **Step 1: Set backend job working directory and cache path**

Use this backend job body:

```yaml
  backend:
    name: Backend — pytest
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: backend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.11"
          cache: pip
          cache-dependency-path: backend/requirements.txt
      - name: Install deps
        run: pip install -r requirements.txt
      - name: Run tests
        run: python -m pytest -q
```

- [ ] **Step 2: Preserve the frontend job boundary**

Keep `working-directory: frontend`, Node.js `20`, npm cache path
`frontend/package-lock.json`, and the commands `npm ci`, `npm run typecheck`,
`npm run test`, `npm run build`.

- [ ] **Step 3: Run equivalent local CI commands**

Run from `backend/`: `python -m pytest -q`

Run from `frontend/`:

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd run test
npm.cmd run build
```

Expected: all commands exit 0.

- [ ] **Step 4: Commit CI alignment**

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: run checks inside app boundaries"
```

### Task 5: Add beginner-friendly orchestration scripts

**Files:**
- Create: `scripts/dev.ps1`
- Create: `scripts/test.ps1`

**Interfaces:**
- Consumes: backend/frontend standard commands.
- Produces: root commands for starting development servers and running all local checks.

- [ ] **Step 1: Create `scripts/dev.ps1`**

```powershell
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Start-Process powershell -WorkingDirectory (Join-Path $root "backend") -ArgumentList @(
    "-NoExit",
    "-Command",
    "python -m uvicorn app.main:app --reload --port 8000"
)

Start-Process powershell -WorkingDirectory (Join-Path $root "frontend") -ArgumentList @(
    "-NoExit",
    "-Command",
    "npm.cmd run dev"
)
```

- [ ] **Step 2: Create `scripts/test.ps1`**

```powershell
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Push-Location (Join-Path $root "backend")
try {
    python -m pytest -q
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}

Push-Location (Join-Path $root "frontend")
try {
    npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm.cmd run test
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}
```

- [ ] **Step 3: Run the test orchestrator**

Run: `powershell -ExecutionPolicy Bypass -File scripts/test.ps1`

Expected: backend pytest, frontend typecheck, tests and build all exit 0.

- [ ] **Step 4: Syntax-check the development orchestrator without launching it**

Run:

```powershell
$errors=$null; [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path scripts/dev.ps1),[ref]$null,[ref]$errors) | Out-Null; if ($errors) { $errors; exit 1 }
```

Expected: no output and exit 0.

- [ ] **Step 5: Commit scripts**

```powershell
git add scripts/dev.ps1 scripts/test.ps1
git commit -m "chore: add local development scripts"
```

### Task 6: Update documentation and run final acceptance

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: verified final tree and commands.
- Produces: onboarding and deployment documentation matching the repository.

- [ ] **Step 1: Replace the README project tree**

Document only these top-level boundaries:

```text
backend/       FastAPI source, tests, dependencies and image
frontend/      React source, tests, dependencies and image
docs/          Design and implementation documentation
scripts/       Local development and verification shortcuts
data/          Runtime data; not committed
docker-compose.yml  Full-stack local deployment
```

- [ ] **Step 2: Update local commands**

Document:

```powershell
# Backend
cd backend
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000

# Frontend
cd frontend
npm ci
npm run dev

# Both in separate terminals
powershell -ExecutionPolicy Bypass -File scripts/dev.ps1

# Full verification
powershell -ExecutionPolicy Bypass -File scripts/test.ps1

# Docker
docker compose up --build
```

- [ ] **Step 3: Check README for stale paths**

Run:

```powershell
rg -n 'uvicorn main:app|pip install -r requirements\.txt|root (api_|core|tools|tests)|Dockerfile at root' README.md
```

Expected: no stale root backend references. The backend installation example may contain `pip install -r requirements.txt` only after an explicit `cd backend` line.

- [ ] **Step 4: Run final acceptance commands**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test.ps1
docker compose config
python -m pytest backend/tests/test_project_layout.py backend/tests/test_deployment_layout.py -q
```

Expected: every command exits 0.

- [ ] **Step 5: Inspect final root**

Run: `Get-ChildItem -Force | Select-Object Name`

Expected: no root `main.py`, `api_*.py`, `core/`, `tools/`, `tests/`, `Dockerfile` or `requirements.txt`; `Dockerfile.executor` remains intentionally.

- [ ] **Step 6: Commit docs**

```powershell
git add README.md
git commit -m "docs: document deploy-ready project structure"
```
