const path = require('path')

function getBackendExecutable(resourceRoot, exists) {
  const candidates = [
    path.join(resourceRoot, 'backend', 'dist', 'backend', 'backend.exe'),
    path.join(resourceRoot, 'backend', 'dist', 'backend.exe'),
    path.join(resourceRoot, 'backend', 'backend.exe'),
  ]
  return candidates.find(exists) || null
}

module.exports = { getBackendExecutable }
