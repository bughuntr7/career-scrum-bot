#!/usr/bin/env python3
"""
ZipRecruiter: use nodriver (undetected Chrome) to pass Cloudflare, then export
cookies to a JSON file for the Node/Playwright scripts to load.

Usage:
  pip install -r requirements-nodriver.txt
  python scripts/ziprecruiter_nodriver.py

Then run: npm run ziprecruiter:init
(Set ZIPRECRUITER_COOKIES_FILE to the output path if not using default.)
"""

import asyncio
import json
import os
import sys
from pathlib import Path

# Load .env from project root so ZIPRECRUITER_NODRIVER_URL is read
try:
    from dotenv import load_dotenv
    _env = Path(__file__).resolve().parent.parent / ".env"
    if _env.exists():
        load_dotenv(_env)
except ImportError:
    pass


def default_cookies_path() -> str:
    home = os.environ.get("HOME") or os.environ.get("USERPROFILE") or os.getcwd()
    jobbot = Path(home) / ".jobbot"
    jobbot.mkdir(parents=True, exist_ok=True)
    return str(jobbot / "ziprecruiter-cookies.json")


def cookie_to_editor(c) -> dict:
    """Convert nodriver/CDP cookie to Cookie-Editor style for Node Playwright."""
    domain = getattr(c, "domain", "") or ""
    if domain and not domain.startswith("."):
        domain = "." + domain
    path = getattr(c, "path", "/") or "/"
    expires = getattr(c, "expires", None)
    if expires is not None:
        try:
            expiration_date = int(float(expires))
        except (TypeError, ValueError):
            expiration_date = None
    else:
        expiration_date = None
    http_only = getattr(c, "httpOnly", None) or getattr(c, "http_only", None)
    secure = getattr(c, "secure", None)
    same_site = getattr(c, "sameSite", None) or getattr(c, "same_site", None)
    if same_site is True:
        same_site = "Lax"
    elif same_site is False:
        same_site = None
    out = {
        "name": getattr(c, "name", ""),
        "value": getattr(c, "value", ""),
        "domain": domain or ".ziprecruiter.com",
        "path": path,
    }
    if expiration_date is not None and expiration_date > 0:
        out["expirationDate"] = expiration_date
    if http_only is not None:
        out["httpOnly"] = bool(http_only)
    if secure is not None:
        out["secure"] = bool(secure)
    if same_site:
        out["sameSite"] = str(same_site)
    return out


async def main() -> int:
    try:
        import nodriver
    except ImportError:
        print("nodriver not installed. Run: pip install -r requirements-nodriver.txt", file=sys.stderr)
        return 1
    except SyntaxError as e:
        if "nodriver" in str(e.filename or ""):
            print(
                "nodriver has an encoding bug on Python 3.14 (SyntaxError in cdp/network.py).\n"
                "Use Python 3.12 or 3.13 for this script, e.g.:\n"
                "  py -3.12 scripts/ziprecruiter_nodriver.py\n"
                "Or patch the file: open site-packages/nodriver/cdp/network.py, line ~1365,\n"
                "replace the invalid character in the comment with 'Inf' and add at top: # -*- coding: utf-8 -*-",
                file=sys.stderr,
            )
        else:
            print(f"SyntaxError: {e}", file=sys.stderr)
        return 1

    url = os.environ.get(
        "ZIPRECRUITER_NODRIVER_URL",
        "https://www.ziprecruiter.com/jobs-search?search=Machine+Learning+Engineer&location=Remote+%28USA%29&refine_by_location_type=&radius=5000&days=5&refine_by_employment=employment_type%3Afull_time&refine_by_experience_level=senior%2Cmid&refine_by_apply_type=&refine_by_salary=120000&refine_by_salary_ceil=&lk=MJv3qHnmGw5k5x5_pTY33Q&page=1",
    )
    out_path = os.environ.get("ZIPRECRUITER_COOKIES_FILE") or default_cookies_path()

    print("\nZipRecruiter – nodriver (undetected Chrome)\n")
    print(f"URL: {url}")
    print(f"Cookies will be saved to: {out_path}\n")
    print("A Chrome window will open. Complete the Cloudflare verification if shown,")
    print("then wait until the job search page loads. Press ENTER here when done.\n")

    browser = None
    try:
        browser = await nodriver.Browser.create()
        await browser.get(url)
        await browser.wait(2)
        input("When the page has loaded (and any Cloudflare check is done), press ENTER to export cookies... ")
        cookies = await browser.cookies.get_all(requests_cookie_format=False)
        # Filter to ZipRecruiter-related and Cloudflare
        editor_cookies = []
        for c in cookies:
            d = getattr(c, "domain", "") or ""
            if "ziprecruiter" in d.lower() or "cloudflare" in d.lower():
                editor_cookies.append(cookie_to_editor(c))
        if not editor_cookies:
            editor_cookies = [cookie_to_editor(c) for c in cookies]
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(editor_cookies, f, indent=2)
        print(f"\nExported {len(editor_cookies)} cookies to {out_path}")
        print("Run: npm run ziprecruiter:init")
        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1
    finally:
        if browser:
            try:
                await browser.stop()
            except Exception:
                pass
            await asyncio.sleep(0.25)  # let transports close (reduces Windows asyncio cleanup warnings)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
