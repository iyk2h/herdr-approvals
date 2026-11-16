import json
import os
from pathlib import Path
import sys
import termios
import tty

receipt = Path(sys.argv[1])
original = termios.tcgetattr(sys.stdin.fileno())
tty.setraw(sys.stdin.fileno())
screen = '''Would you like to run the following command?

  $ pnpm test

❯ 1. Yes, proceed (y)
  2. Yes, and don't ask again for commands that start with `pnpm test`
  3. No, and tell Codex what to do differently (esc)

Press enter to confirm or esc to cancel'''
try:
    os.write(1, ('\x1b[2J\x1b[H' + screen.replace('\n', '\r\n') + '\x1b]7501;state=blocked:kind=permission:app=codex\x1b\\').encode())
    cursor = 1
    buffer = b''
    while True:
        buffer += os.read(0, 32)
        while buffer:
            if buffer.startswith(b'\x1b[B'):
                cursor = min(3, cursor + 1); buffer = buffer[3:]
            elif buffer.startswith(b'\x1b[A'):
                cursor = max(1, cursor - 1); buffer = buffer[3:]
            elif buffer[:1] in (b'\r', b'\n'):
                receipt.write_text(json.dumps({'choice':cursor,'fixture':True}) + '\n')
                os.write(1, b'\x1b]7501;state=done:app=codex\x1b\\\r\nFixture finished\r\n')
                sys.exit(0)
            elif buffer == b'\x1b' or buffer == b'\x1b[':
                break
            else:
                buffer = buffer[1:]
finally:
    termios.tcsetattr(sys.stdin.fileno(), termios.TCSADRAIN, original)
