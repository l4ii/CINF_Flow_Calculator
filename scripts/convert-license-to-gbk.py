"""
Build-time script: convert LICENSE.txt (UTF-8) to LICENSE.nsis.txt (GBK).
NSIS on Chinese Windows displays the license using system codepage (GBK);
UTF-8 content would show as garbled. Run this before electron-builder.
"""
import os
import sys

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, 'LICENSE.txt')
out = os.path.join(root, 'LICENSE.nsis.txt')

if not os.path.isfile(src):
    print('LICENSE.txt not found:', src)
    sys.exit(1)

with open(src, 'r', encoding='utf-8') as f:
    content = f.read()

with open(out, 'w', encoding='gbk') as f:
    f.write(content)

print('Created LICENSE.nsis.txt (GBK) for NSIS installer.')
