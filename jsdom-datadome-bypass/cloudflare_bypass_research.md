# Cloudflare Bypass Research

## Key Finding from Reddit (r/webscraping, 18 days ago)

The exact same approach we're trying has been discussed:
1. Use stealth browser to get cf_clearance cookie
2. Switch to curl_cffi for actual requests

**The problem**: cf_clearance is bound to TLS fingerprint (JA3/JA4).
- If browser was Chrome 144, but curl_cffi impersonates Chrome 124, Cloudflare detects the mismatch
- The fix: **Pin both to the SAME Chrome version**

## Key insight: 
TPS's 403 response had `cf-mitigated: challenge` header.
But wait - does TPS actually use Cloudflare Turnstile/challenge, or is it just basic Cloudflare?

## Important distinction:
- Cloudflare **Turnstile** = requires JS execution, very hard to bypass
- Cloudflare **basic challenge** = may just be checking TLS/HTTP2 fingerprint
- `cf-mitigated: challenge` could mean the basic JS challenge, not Turnstile

## Possible approach:
1. The TPS 403 response was 519KB - that's a full page with a captcha challenge
2. But our Camoufox browsers pass Cloudflare fine - so Cloudflare is passable
3. The question: can we get cf_clearance from a browser, then use it with curl_cffi?
4. OR: does TPS even need cf_clearance? Maybe the DataDome cookie is enough if we fix the TLS fingerprint?

## Next test:
- Check if TPS sets cf_clearance cookie in the browser
- Try curl_cffi with the EXACT same impersonation version as the browser
- Try tls-requests library which may have better fingerprint matching
