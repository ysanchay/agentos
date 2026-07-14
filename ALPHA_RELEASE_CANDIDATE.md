# AgentOS Alpha Release Candidate 1 (RC1)

**Effective Date**: 2026-06-23 (checklist; execution parallel to dogfooding)
**Authority**: Chief Architect directive — product-first execution
**Status**: In progress — items completed in parallel with internal dogfooding

---

## 1. RC1 Definition

AgentOS Alpha RC1 is the first build distributed to external alpha users. It must be installable, configurable, observable, and documented well enough for a non-team-member to use successfully.

## 2. RC1 Checklist

### 2.1 Documentation (P0 — blocks RC1)

- [ ] Root README.md — DONE (2026-06-23)
- [ ] Per-package README.md for all 15 packages
  - [ ] @agentos/types
  - [ ] @agentos/kernel
  - [ ] @agentos/eventstore
  - [ ] @agentos/blackboard
  - [ ] @agentos/resources
  - [ ] @agentos/protocol
  - [ ] @agentos/memory
  - [ ] @agentos/swarm
  - [ ] @agentos/capabilities
  - [ ] @agentos/browser
  - [ ] @agentos/desktop
  - [ ] @agentos/llm
  - [ ] @agentos/offline
  - [ ] @agentos/simulation
  - [ ] @agentos/benchmarks
- [ ] Installation guide (INSTALL.md)
- [ ] Configuration guide (CONFIGURATION.md)
- [ ] User onboarding guide (ONBOARDING.md)
- [ ] API reference (auto-generated from TSDoc)
- [ ] Developer SDK documentation
- [ ] Troubleshooting guide (TROUBLESHOOTING.md)

### 2.2 Configuration Externalization (P0 — blocks RC1)

- [ ] Environment variable support:
  - [ ] AGENTOS_LLM_BASE_URL — LLM endpoint URL
  - [ ] AGENTOS_HEALTH_CHECK_URL — connectivity probe endpoint
  - [ ] AGENTOS_SWARM_MAX_WORKERS — max workers per manager
  - [ ] AGENTOS_SWARM_MAX_RETRIES — max task retries
  - [ ] AGENTOS_SWARM_VALIDATION_THRESHOLD — validation consensus threshold
  - [ ] AGENTOS_DATA_DIR — telemetry and cache storage location
  - [ ] AGENTOS_LOG_LEVEL — logging verbosity (debug/info/warn/error)
- [ ] Configuration file support (.agentos.yaml or .agentos.json)
- [ ] Default values documented

### 2.3 Packaging (P1 — needed for distribution)

- [ ] npm package publishable (pnpm publish --filter @agentos/*)
- [ ] Global CLI entry point (agentos command)
  - [ ] agentos init — initialize workspace
  - [ ] agentos run <objective> — delegate a task
  - [ ] agentos status — show system status
  - [ ] agentos version — show version
  - [ ] agentos config — show/edit configuration
  - [ ] agentos telemetry — show telemetry summary
- [ ] Docker container with all dependencies
- [ ] Install script for Linux/macOS

### 2.4 CI/CD (P1 — needed for stability)

- [ ] GitHub Actions workflow: lint + typecheck + test on every PR
- [ ] GitHub Actions workflow: build all packages on merge to main
- [ ] Automated release: tag → build → publish → release notes
- [ ] Test matrix: Node.js 20+ on Linux and macOS
- [ ] Coverage report on every PR (minimum threshold: 60%)

### 2.5 Stub Completion (P1 — needed for full functionality)

- [ ] Embedding API in capabilities/local-model-provider.ts
  - Implement real embedding call or integrate local embedding model
  - Add test coverage
- [ ] OCR strategy in desktop/ocr-strategy.ts
  - Integrate Tesseract or similar OCR engine
  - Add test coverage
- [ ] Browser workspace tracking TODO in browser/browser-pool.ts
  - Implement workspace session isolation
  - Add test coverage

### 2.6 Observability (P1 — needed for dogfooding)

- [ ] Structured logging with configurable levels
- [ ] Debug mode: trace all capability invocations
- [ ] Mission Control auto-refresh (polling or event-driven)
- [ ] Telemetry export command (agentos telemetry --export)
- [ ] Health check endpoint for Docker

### 2.7 Error Handling (P1 — needed for reliability)

- [ ] Circuit breakers on external API calls (browser, HTTP provider)
- [ ] Retry with exponential backoff for transient failures
- [ ] Timeout enforcement on all I/O operations
- [ ] User-friendly error messages (no stack traces in user-facing output)
- [ ] Error code reference document (KER-xxxx, OFF-xxxx, etc.)

### 2.8 Security (P2 — needed before external distribution)

- [ ] API key management (environment variables, never hardcoded)
- [ ] Workspace isolation verification
- [ ] Permission audit log
- [ ] Download sandboxing (size limit, MIME type allowlist)

## 3. RC1 Release Process

1. Complete all P0 items above
2. Complete all P1 items above (or document as known limitations)
3. Run full test suite: `pnpm test` — all tests must pass
4. Run 100-benchmark suite: all 4 Alpha criteria must pass
5. Run real-world task suite: all 11 tasks must pass
6. Run three-mode benchmark: all 3 modes must pass
7. Create release tag: v0.1.0-alpha.1
8. Generate release notes from CHANGELOG
9. Build distribution packages
10. Internal team smoke test (1 day)
11. Release to external alpha users

## 4. RC1 Known Limitations

These limitations are acceptable for Alpha but must be documented:

- No GUI — CLI only
- No multi-user concurrent sessions on same workspace
- Browser automation requires Playwright browser installation
- Desktop automation requires platform-specific dependencies
- No automatic updates — manual reinstall required
- No cloud sync — all data is local
- No marketplace or plugin system
- No Reputation Engine or Agent Economy
- Offline mode uses local models only (no cloud fallback when offline)
- No mobile support

## 5. Version History

| Version | Date | Change |
|---------|------|--------|
| 1.0 | 2026-06-23 | Initial RC1 checklist |