# DataDome Interstitial Complete Flow

## Architecture
The interstitial page (434KB) contains:
1. A `ddm` config object (seed, cid, hash, encrypted env data)
2. A massive webpack-bundled JS challenge solver (~400KB, heavily obfuscated with custom VM)
3. An `interstitialCallback` function that POSTs results to `/interstitial/`
4. Response handling: if `json.view == 'redirect'` → success, get cookie via postMessage

## Challenge Solver Steps (from the webpack code):
1. `interstitialChallenge()` creates a `G` object with stepCountMax=5
2. Step 0: Collect fingerprints (F() function), set version "1.28.0"
3. Step 1: Execute first phase of fingerprinting
4. Step 2: Compute proof-of-work based on `ddm.seed` (E function = checksum)
5. Step 3: Hash integrity check of the code itself
6. Step 4: Finalize, build payload with `plv2` (fingerprint) and `plv3` (proof-of-work result)
7. POST to `/interstitial/` with the payload

## POST body format:
```
cid=...&hash=...&s=...&e=...&b=...&dm=cd&payload=<plv2>&plv3=<plv3>
```

## Response:
- `{"view": "redirect", "url": "...", "cookie": "datadome=..."}` → SUCCESS
- `{"view": "captcha", "url": "..."}` → FAILED, need captcha

## Key Insight:
The challenge JS uses `window`, `document`, `navigator`, `screen` etc.
jsdom provides these but DataDome's fingerprinting checks for:
- Canvas API (jsdom doesn't have)
- WebGL (jsdom doesn't have)
- Audio context (jsdom doesn't have)

However, the interstitial challenge (rt='i') is the NON-captcha path.
It may not require all browser APIs - it might just need basic DOM + proof-of-work.

## Alternative: Use Node.js with a minimal DOM shim
We could run the interstitial HTML in Node.js with:
- jsdom for basic DOM
- Mock canvas, WebGL, etc. with fake values
- Intercept the XMLHttpRequest to capture the payload
- Use curl_cffi to send the payload to DataDome
