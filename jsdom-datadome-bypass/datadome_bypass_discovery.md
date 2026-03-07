# DataDome Tags.js Bypass - CRITICAL DISCOVERY

## The Flow (No Browser Needed!)

DataDome's tags.js works like this:

1. Browser loads a page → DataDome's `tags.js` is included
2. `tags.js` collects browser fingerprint data (jsData)
3. `tags.js` sends a POST to `https://api-js.datadome.co/js/` with the fingerprint
4. DataDome returns a `datadome` cookie
5. Subsequent requests use this cookie

## Key Insight: You can FAKE step 2-4 without a browser!

The `bypass-datadome` project (github.com/ellisfan/bypass-datadome) shows exactly how.

### What jsData Contains (~100+ fields):
- Screen resolution: br_h, br_w, rs_h, rs_w, ars_h, ars_w
- Hardware: hc (hardware concurrency), dvm (device memory)
- Browser capabilities: media codecs (aco, acmp, vch, etc.)
- Plugins: plg, plu, mmt
- WebGL: glvd (vendor), glrd (renderer)
- Storage: str_ss, str_ls, str_idb
- Timezone: tz, tzp
- Language: lg
- Canvas fingerprint: cfpfe (base64 encoded)
- Stack trace fingerprint: stcfp (base64 encoded)
- Many boolean flags for detection evasion checks

### The Request:
```
POST https://api-js.datadome.co/js/
Content-Type: application/x-www-form-urlencoded

Parameters:
- ddv: DataDome version (e.g., "4.25.0")
- eventCounters: []
- jsType: "ch"
- ddk: DataDome key (from the website's tags.js URL parameter)
- request: "%2F"
- responsePage: "origin"
- cid: "null"
- Referer: target URL
- jsData: JSON object with all the fingerprint data
```

### Response:
Returns a `datadome` cookie that can be used for subsequent requests!

## Requirements to Make This Work:
1. Need the `ddk` (DataDome key) from TPS's tags.js
2. Need to use `browserforge` to generate realistic fingerprint data
3. Need `curl_cffi` with correct TLS fingerprint to send the POST
4. Need residential proxy IP

## Why This is a Game Changer:
- Each "worker" = 1 Python async coroutine (~1MB memory)
- Can run 1000+ concurrent "workers" on 32GB
- Cookie generation takes ~100ms (vs 5-10s for browser warmup)
- If blocked, just generate a new cookie instantly
- No browser process management overhead

## BUT - Important Caveats:
1. This is for DataDome v4.25.0 - current version may be different
2. DataDome may have added new signals since this was written (2 years ago)
3. The `cfpfe` and `stcfp` fields contain base64-encoded canvas/stack data
4. DataDome's dynamic key rotation changes signal names daily
5. Need to verify if TPS uses the same DataDome version/config


## IMPORTANT UPDATE (Feb 2026):
DataDome has released **VM obfuscation for Device Check & Slider** - described as their 
"most significant advancement". This means the interstitial/device check JS is now 
protected by a virtual machine, making it MUCH harder to reverse-engineer.

Source: PentesterLab LinkedIn post, Feb 15, 2026

This significantly complicates the pure-HTTP approach because:
1. The signals collection code is now VM-obfuscated
2. Signal names rotate daily (dynamic keys)
3. New WASM-based challenges have been added
4. Dynamic hash challenges verify browser details

## Revised Assessment:

### Option A: Reverse-engineer DataDome VM (VERY HARD)
- Need to deobfuscate VM-protected JS
- Need to track daily signal key rotations
- Need to solve WASM challenges
- Maintenance nightmare - DataDome updates frequently
- Estimated effort: weeks to months, ongoing maintenance

### Option B: Use a DataDome solver service (PAID)
- TakionAPI, Capsolver, etc. offer DataDome solving
- They maintain the reverse engineering
- Cost per solve varies

### Option C: Lightweight browser approach (PRACTICAL)
- Use BotBrowser or similar with route.fetch()
- Real browser handles JS/DataDome automatically
- Much lighter than full Camoufox
- No reverse engineering needed
