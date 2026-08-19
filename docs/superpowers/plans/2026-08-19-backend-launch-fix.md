# Backend Launch Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure Electron development startup uses the already-built backend executable before falling back to a system Python environment.

**Architecture:** Extract backend executable discovery into a dependency-free CommonJS helper so it can be tested without loading Electron. Use that helper in both development and packaged modes; this preserves packaged mode's onedir-before-onefile ordering and keeps system Python as a last fallback only.

**Tech Stack:** Node.js built-in test runner, CommonJS, Python 3.8 embedded runtime, Flask.

---

### Task 1: Prefer the built backend during development

**Files:**
- Create: `electron/backend-runtime.js`
- Modify: `electron/main.js:1-8,329-362`
- Modify: `tests/backend-launch.test.js`

- [x] **Step 1: Write the failing test**

```javascript
test('selects the onefile backend executable when it exists', () => {
  assert.equal(
    getBackendExecutable('D:/app', (candidate) => candidate.endsWith(path.join('dist', 'backend.exe'))),
    path.join('D:/app', 'backend', 'dist', 'backend.exe')
  )
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/backend-launch.test.js`

Expected: FAIL because `electron/backend-runtime.js` does not exist.

- [x] **Step 3: Write minimal implementation**

```javascript
function getBackendExecutable(resourceRoot, exists) {
  const candidates = [
    path.join(resourceRoot, 'backend', 'dist', 'backend', 'backend.exe'),
    path.join(resourceRoot, 'backend', 'dist', 'backend.exe'),
    path.join(resourceRoot, 'backend', 'backend.exe'),
  ]
  return candidates.find(exists) || null
}
```

Use this helper at the beginning of `findBackendExecutable()` so development startup chooses the PyInstaller executable before consulting system Python. Keep onedir first, then onefile, then the legacy root executable.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/backend-launch.test.js`

Expected: PASS for executable selection.

### Task 2: Verify the startup path

**Files:**
- Modify: `package.json`

- [x] **Step 1: Add a test command**

```json
"test": "node --test tests/backend-launch.test.js"
```

- [x] **Step 2: Run focused and package verification**

Run: `npm test` and `npm run build`

Expected: the launch tests pass and the frontend production build completes.

- [x] **Step 3: Commit**

```bash
git add electron/backend-runtime.js electron/main.js package.json tests/backend-launch.test.js docs/superpowers/plans/2026-08-19-backend-launch-fix.md
git commit -m "fix: prefer built backend during development"
```
