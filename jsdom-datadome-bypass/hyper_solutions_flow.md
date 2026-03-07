# Hyper Solutions - DataDome Interstitial Flow

## The Complete Flow (from docs.hypersolutions.co):

### Step 1: Parse the 403 HTML
Extract from `dd` object: `cid`, `hsh`, `s`, `b`
Also save: `datadome` cookie from response, referer URL

### Step 2: Build deviceLink URL
```
https://geo.captcha-delivery.com/interstitial/?initialCid={cid}&hash={hsh}&cid={datadomeCookie}&referer={referer}&s={s}&b={b}&dm=cd
```

### Step 3: GET the deviceLink (fetch interstitial HTML)
- Send same headers as browser
- Save full response body (this is the 434KB page with VM code)

### Step 4: Send to Hyper Solutions API to generate payload
Input: userAgent, deviceLink, html (full interstitial response)
Output: payload (Form Data string)

### Step 5: POST payload to interstitial endpoint
POST to: `https://geo.captcha-delivery.com/interstitial/`
Response: `{"cookie": "datadome=...", "view": "redirect", "url": "..."}`

### Step 6: Use the new cookie
Update cookie jar, retry original request

## KEY INSIGHT:
Hyper Solutions API handles the hard part (Step 4) - generating the correct payload
from the interstitial HTML. This is where the VM execution and fingerprint generation happens.

They have SDKs for Go, Python, JS/TS.

## This means:
We can use Hyper Solutions (or similar) as a "payload generator" service,
combined with curl_cffi for all HTTP requests.

Architecture:
1. curl_cffi → GET TPS search page → 403 + dd params
2. curl_cffi → GET deviceLink → interstitial HTML  
3. Hyper Solutions API → generate payload from HTML
4. curl_cffi → POST payload → get valid cookie
5. curl_cffi → GET TPS with cookie → SUCCESS!

NO BROWSER NEEDED AT ALL!
