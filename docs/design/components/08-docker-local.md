# Component 8 — Docker Local Stack

Makes the whole stack locally deployable and testable with Docker: build, test, and
serve the site (including the R2-backed image Function) in containers, with no host
Node/PowerShell/wrangler required. Added as a user requirement (2026-07-05); also
removes any sensitivity to host toolchain versions.

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `scripts/test.ps1` (single test entry point, used in and out of Docker)
- Create: `scripts/dev-seed.ps1` (promotes component 7 §4's snippet to a real script)
- Modify: `.gitignore` — already covers `.wrangler/`; no change expected, verify.

**Interfaces:**
- Consumes: `scripts/build.ps1` (component 3), `scripts/test.ps1` targets
  (components 1/2/3/4/6 test suites), `wrangler.jsonc` + local R2 simulation
  (component 6), `.r2-stage/` layout (component 3).
- Produces: `docker compose run --rm build|test`, `docker compose up web` →
  site + Function + simulated R2 on `http://localhost:8788`.

---

## 1. Principle

The containers run **the same pwsh entry-point scripts as the host** — Docker is an
environment, not a second build system. The image therefore contains Node 24, pwsh,
and Pester; the repo is bind-mounted so iteration doesn't require image rebuilds.

Publishing (`publish.ps1`) stays host-side: it needs `wrangler login` and rclone
credentials, and Phase 0 is manual anyway. (It *can* be run in the container by
mounting credential config, but that is not a supported path in this design.)

## 2. `Dockerfile`

```dockerfile
FROM node:24-bookworm-slim

# pwsh: tar.gz install (the Microsoft apt repo is amd64-only; this works on arm64 Macs too)
ARG TARGETARCH
ARG PWSH_VERSION=7.5.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates libicu72 \
 && arch=$([ "$TARGETARCH" = "arm64" ] && echo linux-arm64 || echo linux-x64) \
 && curl -fsSL "https://github.com/PowerShell/PowerShell/releases/download/v${PWSH_VERSION}/powershell-${PWSH_VERSION}-${arch}.tar.gz" -o /tmp/pwsh.tgz \
 && mkdir -p /opt/pwsh && tar -xzf /tmp/pwsh.tgz -C /opt/pwsh \
 && chmod +x /opt/pwsh/pwsh && ln -s /opt/pwsh/pwsh /usr/local/bin/pwsh \
 && rm /tmp/pwsh.tgz && rm -rf /var/lib/apt/lists/*

RUN pwsh -NoProfile -Command "Install-Module Pester -Force -Scope AllUsers"

WORKDIR /app
ENV PATH=/app/node_modules/.bin:$PATH
CMD ["pwsh"]
```

Notes: `libicu72` is required by pwsh on bookworm. Dependencies are **not** baked
into the image — the repo (including `package.json`) is bind-mounted, and
`build.ps1`/`test.ps1` run `npm install` when `node_modules` is missing, which lands
in the compose-managed volume below. This keeps image rebuilds rare (only when the
toolchain itself changes).

## 3. `docker-compose.yml`

```yaml
services:
  shell: &base
    build: .
    volumes:
      - .:/app
      - node_modules:/app/node_modules   # container-native modules (sharp!), shadows host's
      - wrangler_state:/app/.wrangler    # persists the simulated R2 bucket between runs
    working_dir: /app

  build:
    <<: *base
    command: pwsh scripts/build.ps1

  test:
    <<: *base
    command: pwsh scripts/test.ps1

  web:
    <<: *base
    command: npx wrangler pages dev build --ip 0.0.0.0 --port 8788
    ports:
      - "8788:8788"

volumes:
  node_modules:
  wrangler_state:
```

Key points:
- **`node_modules` named volume** — sharp installs platform-specific binaries; the
  container must never use macOS-host `node_modules` (and vice versa). The volume
  shadows the bind mount at that path.
- **`wrangler_state` volume** — wrangler's local R2 simulation lives under
  `.wrangler/`; persisting it means `dev-seed` results survive container restarts.
- **`--ip 0.0.0.0`** — required for the port mapping to work from the host.

## 4. `scripts/test.ps1`

Single test entry point (works on host and in container):

```powershell
#!/usr/bin/env pwsh
# Run all automated tests: node --test suites + Pester for the pwsh scripts.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
Push-Location $root
try {
    if (-not (Test-Path (Join-Path $root 'node_modules'))) { npm install }

    node --test scripts/
    if ($LASTEXITCODE -ne 0) { throw 'node tests failed' }

    if (Get-Module -ListAvailable Pester) {
        Invoke-Pester (Join-Path $root 'scripts') -CI
        if ($LASTEXITCODE -ne 0) { throw 'Pester tests failed' }
    } else {
        Write-Warning 'Pester not installed - skipping pwsh script tests'
    }
}
finally { Pop-Location }
```

`node --test scripts/` recurses into `scripts/lib/`, picking up every `*.test.mjs`.

## 5. `scripts/dev-seed.ps1`

Loads `.r2-stage/` into wrangler's **local** simulated bucket so the lightbox works
under `docker compose up web` (and plain `wrangler pages dev`):

```powershell
#!/usr/bin/env pwsh
# Seed the local (simulated) R2 bucket from .r2-stage - run after build.ps1.
$ErrorActionPreference = 'Stop'
$root  = Split-Path $PSScriptRoot
$stage = Join-Path $root '.r2-stage'
if (-not (Test-Path $stage)) { throw 'Nothing staged - run build.ps1 first' }

Get-ChildItem $stage -Recurse -File | ForEach-Object {
    $key = [IO.Path]::GetRelativePath($stage, $_.FullName) -replace '\\', '/'
    npx wrangler r2 object put "pictures-elton/$key" --file $_.FullName --local | Out-Null
    Write-Host "seeded $key"
}
```

## 6. Local workflow (documented in README later)

```bash
docker compose run --rm build          # renditions + HTML into build/
docker compose run --rm shell pwsh scripts/dev-seed.ps1   # load images into local R2
docker compose up web                  # http://localhost:8788 — full stack, incl. Function
docker compose run --rm test           # whole automated test suite
```

## 7. Test plan

| Check | Steps |
|---|---|
| image builds | `docker compose build` succeeds on arm64 (and amd64 if available) |
| tests in container | `docker compose run --rm test` → node suites + Pester all pass |
| full local stack | build → dev-seed → `up web`: home page, gig page, thumbs load; lightbox loads `/img/web/...` from the simulated bucket (200 + immutable cache header via `curl -I localhost:8788/img/web/<slug>/<file>`) |
| state persistence | `docker compose down` (not `-v`) then `up web` again — seeded images still served |
| no host toolchain | all of the above with host `node`/`pwsh` renamed away or ignored |
| host/container isolation | after container runs, host `npm test` (if host Node ≥ 20) still works — no platform-mismatched `node_modules` in the repo dir |

## 8. Acceptance criteria

- [ ] Full local stack check passes end-to-end on this machine (Apple Silicon).
- [ ] `docker compose run --rm test` is green and is the single command CI-or-human
      needs for regression testing.
