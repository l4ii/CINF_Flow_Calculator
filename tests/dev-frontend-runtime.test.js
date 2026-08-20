const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

test('uses the Flow Calculator development frontend URL', () => {
  const { DEV_FRONTEND_URL, DEV_FRONTEND_PORT } = require('../electron/dev-frontend-runtime')

  assert.equal(DEV_FRONTEND_PORT, 5173)
  assert.equal(DEV_FRONTEND_URL, 'http://127.0.0.1:5173')
})

test('starts Vite with an exclusive Flow Calculator development port', () => {
  const root = path.resolve(__dirname, '..')
  const viteConfig = fs.readFileSync(path.join(root, 'frontend', 'vite.config.ts'), 'utf8')
  const frontendPackage = fs.readFileSync(path.join(root, 'frontend', 'package.json'), 'utf8')
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

  assert.match(viteConfig, /host:\s*'127\.0\.0\.1'/)
  assert.match(viteConfig, /port:\s*5173/)
  assert.match(viteConfig, /strictPort:\s*true/)
  assert.match(frontendPackage, /--kill-others-on-fail/)
  assert.match(frontendPackage, /wait-on http:\/\/127\.0\.0\.1:5173/)
  assert.equal(packageJson.scripts.start, 'npm run dev --prefix frontend')
})
