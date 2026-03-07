#!/usr/bin/env python3
"""
DataDome Interstitial Bypass via jsdom (no browser required)

End-to-end flow:
1. Request target URL -> get 403 with dd object
2. Fetch interstitial challenge page
3. Execute challenge JS in Node.js jsdom with mocked browser APIs
4. Capture the POST payload and submit to DataDome
5. Extract cookie and use it to access the target page

Dependencies:
  pip: curl_cffi
  npm: jsdom @napi-rs/canvas (in /home/ubuntu/node_modules/)
"""
import subprocess, json, re, random, time, os, urllib.parse, sys
from curl_cffi import requests as cffi_requests

PROXY_USER = "baobao88667"
PROXY_PASS_BASE = "ib3itu0y152BDW0Scg1m"
SOLVER_JS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "jsdom_solver.cjs")

def make_proxy():
    sid = str(random.randint(1000000, 9999999))
    pwd = f"{PROXY_PASS_BASE}_country-US_session-{sid}"
    proxy = f"http://{PROXY_USER}:{pwd}@core-residential.evomi.com:1000"
    return {"http": proxy, "https": proxy}, sid

def get_datadome_cookie(session):
    """Extract datadome cookie from session cookie jar"""
    try:
        return session.cookies.get("datadome", "")
    except:
        return ""

def step1_get_challenge(session, target_url, proxies):
    """Request target URL and extract DataDome challenge parameters"""
    resp = session.get(target_url, headers={
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Sec-Ch-Ua": '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }, proxies=proxies, timeout=15)
    
    print(f"  Status: {resp.status_code} | Size: {len(resp.text)}")
    
    if resp.status_code == 200 and len(resp.text) > 10000:
        return {"status": "not_blocked", "response": resp}
    
    dd_match = re.search(r"var dd=(\{[^}]+\})", resp.text)
    if not dd_match:
        if len(resp.text) > 100000:
            return {"status": "captcha_page", "message": "Got captcha page (IP flagged)", "response": resp}
        return {"status": "error", "message": "No dd object found", "response": resp}
    
    dd_str = dd_match.group(1).replace("'", '"')
    dd_obj = json.loads(dd_str)
    
    cookie_val = get_datadome_cookie(session)
    if not cookie_val:
        cookie_val = dd_obj.get("cookie", "")
    
    return {
        "status": "challenge",
        "rt": dd_obj.get("rt", ""),
        "cid": dd_obj["cid"],
        "hsh": dd_obj["hsh"],
        "b": str(dd_obj["b"]),
        "s": str(dd_obj["s"]),
        "e": dd_obj.get("e", ""),
        "cookie": cookie_val,
        "response": resp,
    }

def step2_fetch_interstitial(session, challenge, target_url, proxies):
    """Fetch the interstitial challenge page HTML"""
    referer_encoded = urllib.parse.quote(target_url)
    interstitial_url = (
        f"https://geo.captcha-delivery.com/interstitial/"
        f"?initialCid={urllib.parse.quote(challenge['cid'])}"
        f"&hash={urllib.parse.quote(challenge['hsh'])}"
        f"&cid={urllib.parse.quote(challenge['cookie'])}"
        f"&s={challenge['s']}"
        f"&e={challenge['e']}"
        f"&b={challenge['b']}"
        f"&dm=cd"
        f"&referer={referer_encoded}"
    )
    
    resp = session.get(interstitial_url, headers={
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": urllib.parse.urlparse(target_url).scheme + "://" + urllib.parse.urlparse(target_url).netloc + "/",
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
    }, proxies=proxies, timeout=15)
    
    print(f"  Status: {resp.status_code} | Size: {len(resp.text)}")
    
    if resp.status_code != 200 or len(resp.text) < 10000:
        return None, interstitial_url
    
    return resp.text, interstitial_url

def step3_solve_jsdom(html_content, interstitial_url, target_url):
    """Execute challenge JS in Node.js jsdom and capture the POST payload"""
    html_path = "/tmp/dd_challenge.html"
    payload_path = "/tmp/dd_payload.txt"
    cookie_path = "/tmp/dd_cookie.txt"
    
    with open(html_path, "w") as f:
        f.write(html_content)
    
    for p in [payload_path, cookie_path]:
        if os.path.exists(p):
            os.remove(p)
    
    start = time.time()
    result = subprocess.run(
        ["node", SOLVER_JS, html_path, interstitial_url, target_url],
        capture_output=True, text=True, timeout=20,
        cwd="/home/ubuntu"
    )
    elapsed = time.time() - start
    print(f"  jsdom execution: {elapsed:.1f}s")
    
    # Check stdout for payload capture
    for line in result.stdout.strip().split("\n"):
        line = line.strip()
        if line.startswith("PAYLOAD_CAPTURED:"):
            print(f"  {line}")
        elif line.startswith("COOKIE_CAPTURED"):
            print(f"  {line}")
    
    # Check stderr for errors (ignore "Not implemented" warnings)
    for line in result.stderr.strip().split("\n"):
        line = line.strip()
        if line and "Not implemented" not in line and "navigation" not in line:
            print(f"  stderr: {line}")
    
    if os.path.exists(payload_path):
        with open(payload_path) as f:
            payload = f.read()
        
        # Parse and display payload fields
        params = urllib.parse.parse_qs(payload, keep_blank_values=True)
        total_payload_len = len(params.get("payload", [""])[0])
        has_plv3 = "plv3" in params
        print(f"  Payload fields: {len(params)} | payload_len={total_payload_len} | plv3={'yes' if has_plv3 else 'no'}")
        
        return payload
    
    return None

def step4_submit_payload(session, payload, interstitial_url, proxies):
    """Submit the solved payload to DataDome"""
    resp = session.post(
        "https://geo.captcha-delivery.com/interstitial/",
        data=payload,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": "https://geo.captcha-delivery.com",
            "Referer": interstitial_url,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json",
            "Accept-Language": "en-US,en;q=0.9",
        },
        proxies=proxies, timeout=15,
    )
    
    print(f"  Status: {resp.status_code}")
    
    if resp.status_code == 200:
        try:
            data = json.loads(resp.text)
            view = data.get("view", "")
            cookie = data.get("cookie", "")
            url = data.get("url", "")
            print(f"  View: {view}")
            
            if view == "redirect":
                print(f"  Cookie: {cookie[:80]}...")
                return "redirect", cookie
            elif view == "captcha":
                print(f"  Captcha URL: {url[:100]}...")
                return "captcha", None
            else:
                print(f"  Response: {resp.text[:200]}")
                return view, None
        except json.JSONDecodeError:
            print(f"  Not JSON: {resp.text[:200]}")
    else:
        print(f"  Error: {resp.text[:200]}")
    
    return "error", None

def step5_test_cookie(session, target_url, cookie_str, proxies):
    """Test if the obtained cookie works to access the target page"""
    dd_val = re.search(r"datadome=([^;]+)", cookie_str)
    if not dd_val:
        print("  Could not extract datadome value from cookie string")
        return False
    
    dd_cookie = dd_val.group(1)
    time.sleep(0.5)
    
    resp = session.get(target_url, headers={
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cookie": f"datadome={dd_cookie}",
        "Referer": urllib.parse.urlparse(target_url).scheme + "://" + urllib.parse.urlparse(target_url).netloc + "/",
    }, proxies=proxies, timeout=15)
    
    print(f"  Status: {resp.status_code} | Size: {len(resp.text)}")
    
    has_results = "data-detail-link" in resp.text
    if has_results:
        links = re.findall(r'data-detail-link="([^"]+)"', resp.text)
        print(f"  SUCCESS! Got {len(links)} search results WITHOUT A BROWSER!")
        return True
    else:
        print(f"  Cookie did not grant access. First 200 chars: {resp.text[:200]}")
        return False

def main():
    target_url = "https://www.truepeoplesearch.com/resultname?name=john%20smith&citystatezip=new%20york"
    
    if len(sys.argv) > 1:
        target_url = sys.argv[1]
    
    # Retry with different proxy sessions to get an interstitial challenge
    challenge = None
    session = None
    proxies = None
    
    for attempt in range(15):
        proxies, sid = make_proxy()
        session = cffi_requests.Session(impersonate="chrome131")
        
        if attempt == 0:
            try:
                ip_resp = session.get("https://api.ipify.org?format=json", proxies=proxies, timeout=10)
                print(f"Proxy IP: {ip_resp.json()['ip']} (session: {sid})")
            except Exception as e:
                print(f"Proxy check: {e}")
        
        print(f"\n{'=' * 60}")
        print(f"STEP 1: Get DataDome challenge (attempt {attempt + 1})")
        print("=" * 60)
        challenge = step1_get_challenge(session, target_url, proxies)
        
        if challenge["status"] == "not_blocked":
            print("  Not blocked! Page loaded directly.")
            return
        elif challenge["status"] == "captcha_page":
            print(f"  {challenge['message']} - retrying with new IP...")
            continue
        elif challenge["status"] == "error":
            print(f"  Error: {challenge['message']}")
            continue
        elif challenge["status"] == "challenge":
            break
    
    if not challenge or challenge["status"] != "challenge":
        print("\nFailed to get interstitial challenge after 15 attempts")
        return
    
    print(f"  rt={challenge['rt']} cid={challenge['cid'][:30]}... hsh={challenge['hsh']}")
    print(f"  cookie: {challenge['cookie'][:50]}...")
    
    if challenge["rt"] != "i":
        print(f"  Not an interstitial challenge (rt={challenge['rt']})")
        return
    
    # STEP 2
    print("\n" + "=" * 60)
    print("STEP 2: Fetch interstitial challenge page")
    print("=" * 60)
    html_content, interstitial_url = step2_fetch_interstitial(session, challenge, target_url, proxies)
    
    if not html_content:
        print("  Failed to get interstitial page!")
        return
    
    # STEP 3
    print("\n" + "=" * 60)
    print("STEP 3: Solve challenge with jsdom")
    print("=" * 60)
    payload = step3_solve_jsdom(html_content, interstitial_url, target_url)
    
    if not payload:
        print("  Failed to capture payload!")
        return
    
    # STEP 4
    print("\n" + "=" * 60)
    print("STEP 4: Submit payload to DataDome")
    print("=" * 60)
    view, cookie = step4_submit_payload(session, payload, interstitial_url, proxies)
    
    if view == "redirect" and cookie:
        # STEP 5
        print("\n" + "=" * 60)
        print("STEP 5: Test cookie on target page")
        print("=" * 60)
        step5_test_cookie(session, target_url, cookie, proxies)
    elif view == "captcha":
        print("\n  DataDome classified our fingerprint as bot -> captcha")
        print("  The jsdom environment needs more realistic browser mocks")
        print("  Key issues: payload size (~6000 vs ~1200 for real browser)")
    else:
        print(f"\n  Unexpected result: {view}")

if __name__ == "__main__":
    main()
