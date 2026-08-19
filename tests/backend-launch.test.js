const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

test('selects the onefile backend executable when it exists', () => {
  const { getBackendExecutable } = require('../electron/backend-runtime')
  const resourceRoot = path.join('D:', 'app')
  const expected = path.join(resourceRoot, 'backend', 'dist', 'backend.exe')

  assert.equal(
    getBackendExecutable(resourceRoot, (candidate) => candidate === expected),
    expected
  )
})

test('prefers the onedir backend executable over the onefile executable', () => {
  const { getBackendExecutable } = require('../electron/backend-runtime')
  const resourceRoot = path.join('D:', 'app')
  const onedir = path.join(resourceRoot, 'backend', 'dist', 'backend', 'backend.exe')

  assert.equal(getBackendExecutable(resourceRoot, () => true), onedir)
})

test('returns null when no backend executable is present', () => {
  const { getBackendExecutable } = require('../electron/backend-runtime')

  assert.equal(getBackendExecutable('D:/app', () => false), null)
})
