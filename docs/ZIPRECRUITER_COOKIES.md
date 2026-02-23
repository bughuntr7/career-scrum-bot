# ZipRecruiter: Bypass Cloudflare

## Option 1: Nodriver (Python – undetected Chrome)

Use nodriver to open ZipRecruiter in an undetected Chrome window, pass Cloudflare manually, then export cookies for the Node app.

**Note:** Python 3.14 can hit a `SyntaxError` in nodriver’s `cdp/network.py`. If you only have 3.14, run this patch once, then the script:
   ```cmd
   python scripts/patch_nodriver_encoding.py
   npm run ziprecruiter:nodriver
   ```
   (Or install Python 3.12 and run: `py -3.12 scripts/ziprecruiter_nodriver.py`.)

1. Install Python deps:
   ```cmd
   pip install -r requirements-nodriver.txt
   ```

2. Run the script (opens Chrome):
   ```cmd
   python scripts/ziprecruiter_nodriver.py
   ```
   Or: `npm run ziprecruiter:nodriver`

3. In the opened Chrome window, complete the Cloudflare “Verify you are human” step if shown. Wait until the job search page loads.

4. In the terminal, press **ENTER**. The script exports cookies to `%USERPROFILE%\.jobbot\ziprecruiter-cookies.json` (or `ZIPRECRUITER_COOKIES_FILE` if set).

5. Run the Node init so Playwright loads those cookies:
   ```cmd
   npm run ziprecruiter:init
   ```

## Option 2: FlareSolverr (Docker)

FlareSolverr uses undetected Chrome to solve Cloudflare automatically. Requires Docker.

1. Start FlareSolverr:
   ```cmd
   docker run -d -p 8191:8191 -e LOG_LEVEL=info --restart unless-stopped ghcr.io/flaresolverr/flaresolverr:latest
   ```

2. Run init (script will fetch cookies from FlareSolverr):
   ```cmd
   npm run ziprecruiter:init
   ```

3. If FlareSolverr runs elsewhere, set:
   ```cmd
   set FLARESOLVERR_URL=http://your-host:8191
   ```

## Option 3: Manual cookie export

If Cloudflare blocks the automated browser and you don't use FlareSolverr, pass verification in your **normal Chrome** and export cookies.

## Step 1: Install Cookie-Editor

Install the [Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) extension in Chrome (or use any cookie export extension).

## Step 2: Pass Cloudflare in Normal Chrome

1. Open Chrome normally (not via the script).
2. Go to: https://www.ziprecruiter.com/jobs-search?search=Machine+Learning+Engineer&location=Remote&days=5
3. Complete the "Verify you are human" checkbox.
4. Wait until the job search results page loads.

## Step 3: Export Cookies

1. Click the Cookie-Editor icon in Chrome.
2. Click **Export** → **JSON** (or "Export as JSON").
3. Copy the JSON to a file.
4. Save as: `C:\Users\<YourUsername>\.jobbot\ziprecruiter-cookies.json`

Or set the path explicitly:
```cmd
set ZIPRECRUITER_COOKIES_FILE=C:\path\to\ziprecruiter-cookies.json
```

## Step 4: Run the Script

```cmd
npm run ziprecruiter:init
```

The script will load the cookies and should bypass Cloudflare. The session will be saved in the persistent context for future runs.

## Cookie format

The JSON should be an array of cookie objects. Cookie-Editor exports this format:
```json
[
  {"name": "cf_clearance", "value": "...", "domain": "ziprecruiter.com", "path": "/"},
  {"name": "...", "value": "...", "domain": ".ziprecruiter.com", "path": "/"}
]
```

## References

- [How to Bypass Cloudflare with Playwright (BrowserStack)](https://www.browserstack.com/guide/playwright-cloudflare) – launch args, stealth, wait for challenge, human-like behavior.
- [How to Bypass Cloudflare (Bright Data)](https://brightdata.com/blog/web-data/bypass-cloudflare) – detection methods, FlareSolverr, Camoufox/SeleniumBase.

## Notes

- Cookies expire. If Cloudflare appears again after a while, repeat Steps 2–4 or use FlareSolverr.
- The `cf_clearance` cookie is the main one Cloudflare sets after verification.
- Keep the cookie file private (it can identify your session).
