# DataDome Detection Mechanisms & Bypass Research

## What DataDome Checks (Trust Score Components)

### 1. TLS Fingerprinting (JA3)
- Different OS/browsers/libraries produce unique TLS handshake fingerprints
- curl_cffi / curl-impersonate can mimic browser TLS fingerprints
- This is the FIRST check - if TLS looks like Python/requests, instant block

### 2. IP Address Fingerprinting
- Residential IPs = positive trust score
- Mobile IPs = positive trust score
- Datacenter IPs = very negative trust score
- Rate limiting per IP

### 3. HTTP Details
- HTTP/2 required (HTTP/1.1 = bot signal)
- Header order matters
- Header values must match real browser
- curl_cffi supports HTTP/2 with correct fingerprint

### 4. JavaScript Fingerprinting (CRITICAL)
- DataDome injects JS that fingerprints the browser engine
- Collects: canvas, WebGL, fonts, screen resolution, plugins, etc.
- This is the HARDEST to bypass without a real browser
- DataDome JS tag: `window.ddjskey` + `js.datadome.co/tags.js`

### 5. Behavior Analysis
- Request timing patterns
- Mouse movements, scrolling
- Rate of requests

## Current System Architecture
- Camoufox (modified Firefox) = passes TLS + JS fingerprinting
- Each browser instance ~600-700MB RAM
- 45 workers = ~30GB RAM
- JS fetch() from browser context = inherits browser's TLS/cookies
- DataDome cookie obtained via warmup (page.goto to homepage)

## Key Insight
The current system uses browser's fetch() API which:
- Uses the browser's TLS stack (passes JA3)
- Has valid DataDome cookie from warmup
- But DataDome may detect the fetch() pattern vs real navigation
- Status 200 with 52KB = DataDome JS challenge page (not blocked, but challenged)

## Lightweight Alternatives to Research

### Option A: curl_cffi + stolen DataDome cookies
- Memory: ~5MB per process
- Can mimic Chrome/Firefox TLS fingerprint
- BUT: DataDome cookie is tied to JS fingerprint, may not work with different TLS
- Risk: Cookie validation may fail

### Option B: BotBrowser / lightweight headless
- Smaller footprint than Camoufox
- Still needs JS execution for DataDome

### Option C: Multiple lightweight processes with cookie factory
- Use a few browsers ONLY for cookie generation
- Use curl_cffi for actual data fetching with those cookies
- Hybrid approach

### Option D: Scraping API services (ZenRows, ScrapFly, etc.)
- Outsource the bypass entirely
- Pay per request
- No infrastructure management

## Reddit Key Findings (r/webscraping)

### DataDome cookie IS reusable with curl_cffi BUT:
1. Token is bound to "client shape" - TLS fingerprint, HTTP/2 fingerprint, IP, browser signals
2. Environment that MINTS the token must MATCH the environment that REUSES it
3. If you mint in real Chrome and replay with curl_cffi, TLS/HTTP2 mismatch can invalidate
4. IP consistency matters - token can be scoped to IP or ASN
5. Only specific curl_cffi impersonation version works (e.g., Chrome 131 but not others)

### Successful approach (Dismal_Pilot_1561):
- Warm up proxy using real automated browser + captcha solver
- Use curl_cffi with cookies from the browser
- Save new cookies if they get updated (happens often)
- Key: solve captcha first (boosts trust score significantly)
- Result: 15,000 URLs in 4 hours on modest machine

### Critical insight:
- DataDome cookie from Docker Chrome != DataDome cookie from real Mac Chrome
- The JS fingerprint (canvas, WebGL, etc.) differs between environments
- Token becomes "single use" if fingerprint doesn't match
