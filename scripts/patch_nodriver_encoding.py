#!/usr/bin/env python3
"""
One-time patch for nodriver on Python 3.14: fix SyntaxError in cdp/network.py
(line ~1365: comment contains a non-UTF-8 character). Run with the same Python
you use for ziprecruiter_nodriver.py (e.g. Python 3.14).

  python scripts/patch_nodriver_encoding.py

Then run: npm run ziprecruiter:nodriver
"""

import os
import sys


def find_nodriver_network_py() -> str | None:
    for path in sys.path:
        if not path or path == "":
            path = os.getcwd()
        candidate = os.path.join(path, "nodriver", "cdp", "network.py")
        if os.path.isfile(candidate):
            return candidate
    return None


def main() -> int:
    network_py = find_nodriver_network_py()
    if not network_py:
        print("nodriver not found in sys.path. Install it first: pip install -r requirements-nodriver.txt", file=sys.stderr)
        return 1

    print(f"Patching: {network_py}")

    try:
        with open(network_py, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except OSError as e:
        print(f"Cannot read file: {e}", file=sys.stderr)
        return 1

    if not lines:
        print("File is empty.", file=sys.stderr)
        return 1

    # Ensure encoding declaration at top (PEP 263)
    inserted = False
    if not any(line.strip().startswith("#") and "coding" in line for line in lines[:2]):
        lines.insert(0, "# -*- coding: utf-8 -*-\n")
        inserted = True

    # Fix line ~1365: replace non-ASCII in comment (e.g. infinity symbol). 1-based line 1365 = index 1364 (or 1365 after we inserted a line)
    idx = 1365 if inserted else 1364
    if idx < len(lines):
        line = lines[idx]
        if "JSON" in line:
            new_line = "".join(c if ord(c) < 128 else "Inf" for c in line)
            if new_line != line:
                lines[idx] = new_line
                print("Fixed line 1365 (replaced non-ASCII character in comment).")

    try:
        with open(network_py, "w", encoding="utf-8", newline="") as f:
            f.writelines(lines)
    except OSError as e:
        print(f"Cannot write file: {e}", file=sys.stderr)
        return 1

    print("Done. Run: npm run ziprecruiter:nodriver")
    return 0


if __name__ == "__main__":
    sys.exit(main())
