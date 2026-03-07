"""
Test: Use latest Chrome impersonation (chrome142) to see if Cloudflare passes.
Also test: access TPS WITHOUT any DataDome cookie to see what happens.
"""
import random, time, json, re, base64
from browserforge.fingerprints import Screen, FingerprintGenerator
from curl_cffi import requests as cffi_requests

PROXY_USER = "baobao88667"
PROXY_PASS_BASE = "ib3itu0y152BDW0Scg1m"
session_id = f"ddtest_{random.randint(10000, 99999)}"
password = f"{PROXY_PASS_BASE}_country-US_session-{session_id}"
PROXY = f"http://{PROXY_USER}:{password}@core-residential.evomi.com:1000"
proxies = {"http": PROXY, "https": PROXY}

# Test 1: Access TPS with chrome142 WITHOUT any cookie
print("=" * 60)
print("TEST 1: chrome142, NO cookies, residential proxy")
print("=" * 60)

session = cffi_requests.Session(impersonate="chrome142")

# Check IP
ip_resp = session.get("https://api.ipify.org?format=json", proxies=proxies, timeout=10)
print(f"IP: {ip_resp.json()}")

resp = session.get(
    "https://www.truepeoplesearch.com/",
    headers={
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    },
    proxies=proxies, timeout=15, allow_redirects=True,
)

print(f"Status: {resp.status_code}")
print(f"Length: {len(resp.text)}")
print(f"Server: {resp.headers.get('server', 'N/A')}")
print(f"cf-mitigated: {resp.headers.get('cf-mitigated', 'N/A')}")

# Check for set-cookie
for h, v in resp.headers.items():
    if 'cookie' in h.lower():
        print(f"  {h}: {v[:100]}")

if 'captcha' in resp.text.lower()[:500]:
    print("→ CAPTCHA page")
elif 'truepeoplesearch' in resp.text.lower() and 'search' in resp.text.lower()[:2000]:
    print("→ HOMEPAGE LOADED!")
else:
    print(f"→ Unknown: {resp.text[:300]}")

# Test 2: Try different impersonation profiles
print("\n" + "=" * 60)
print("TEST 2: Try multiple impersonation profiles")
print("=" * 60)

for imp in ["chrome142", "chrome136", "chrome131", "firefox144", "firefox135", "safari184"]:
    sess_id = f"test_{imp}_{random.randint(1000,9999)}"
    pwd = f"{PROXY_PASS_BASE}_country-US_session-{sess_id}"
    px = f"http://{PROXY_USER}:{pwd}@core-residential.evomi.com:1000"
    pxs = {"http": px, "https": px}
    
    try:
        s = cffi_requests.Session(impersonate=imp)
        r = s.get(
            "https://www.truepeoplesearch.com/",
            headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Upgrade-Insecure-Requests": "1",
            },
            proxies=pxs, timeout=15, allow_redirects=True,
        )
        
        is_captcha = 'captcha' in r.text.lower()[:1000]
        is_home = 'truepeoplesearch' in r.text.lower() and len(r.text) > 10000
        cf_mit = r.headers.get('cf-mitigated', 'none')
        
        status = "CAPTCHA" if is_captcha else ("HOME!" if is_home else "OTHER")
        print(f"  {imp:20s} → {r.status_code} | {len(r.text):>7d}B | cf-mit={cf_mit:10s} | {status}")
    except Exception as e:
        print(f"  {imp:20s} → ERROR: {str(e)[:60]}")
    
    time.sleep(0.5)

