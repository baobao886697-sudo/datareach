# TPS 403 Response Analysis

## Key Headers
- `set-cookie: datadome=...` — DataDome sets a cookie even on 403
- `x-dd-b: 259` — DataDome bot score (higher = more suspicious)
- `x-datadome: protected` — Confirms DataDome protection
- `accept-ch: Sec-CH-UA,...` — Server requests Client Hints!
- `server: cloudflare` — Behind Cloudflare

## HTML Content
The 403 returns a small HTML page (1281 bytes) with:
1. `dd` object with challenge params (rt='i' = interstitial)
2. Script tag loading `https://ct.captcha-delivery.com/i.js`
3. Cloudflare beacon script

## dd object params:
- `rt: 'i'` — response type = interstitial
- `cid` — challenge ID
- `hsh: 'BA0C85CB01834060078D21FA9FBE55'` — DataDome key (same as DDK)
- `b: 2036849` — unknown
- `s: 50779` — unknown
- `e` — encrypted data
- `host: 'geo.captcha-delivery.com'` — interstitial host
- `cookie` — the datadome cookie value

## CRITICAL FINDING: accept-ch header!
The server sends `accept-ch` requesting Client Hints:
- Sec-CH-UA
- Sec-CH-UA-Mobile
- Sec-CH-UA-Platform
- Sec-CH-UA-Arch
- Sec-CH-UA-Full-Version-List
- Sec-CH-UA-Model
- Sec-CH-Device-Memory

This means on SUBSEQUENT requests, the browser would send these Client Hints headers.
curl_cffi might not be sending these, which could be a detection signal!
