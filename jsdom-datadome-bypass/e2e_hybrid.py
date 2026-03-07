#!/usr/bin/env python3
"""
Hybrid DataDome Interstitial Bypass:
1. Use jsdom to execute challenge JS and capture POST body structure
2. Replace the encrypted payload with one built from realistic signals
3. Remove plv3 field
4. Submit to DataDome
"""
import subprocess, json, re, random, time, os, urllib.parse, sys
from curl_cffi import requests as cffi_requests

PROXY_USER = "baobao88667"
PROXY_PASS_BASE = "ib3itu0y152BDW0Scg1m"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SOLVER_JS = os.path.join(SCRIPT_DIR, "jsdom_solver.cjs")
PAYLOAD_BUILDER = os.path.join(SCRIPT_DIR, "build_payload.cjs")

def make_proxy():
    sid = str(random.randint(1000000, 9999999))
    pwd = f"{PROXY_PASS_BASE}_country-US_session-{sid}"
    proxy = f"http://{PROXY_USER}:{pwd}@core-residential.evomi.com:1000"
    return {"http": proxy, "https": proxy}, sid

def build_custom_payload(cid, hsh, seed="default"):
    """Build a custom encrypted payload using the encryptor library"""
    result = subprocess.run(
        ["node", PAYLOAD_BUILDER, cid, hsh, seed],
        capture_output=True, text=True, timeout=10,
        cwd="/home/ubuntu"
    )
    if result.returncode != 0:
        print(f"  Payload builder error: {result.stderr[:200]}")
        return None
    return result.stdout.strip()

def run_jsdom_solver(html_content, interstitial_url, target_url):
    """Run jsdom solver and capture the POST body"""
    html_path = "/tmp/dd_challenge.html"
    payload_path = "/tmp/dd_payload.txt"
    
    with open(html_path, "w") as f:
        f.write(html_content)
    
    if os.path.exists(payload_path):
        os.remove(payload_path)
    
    start = time.time()
    result = subprocess.run(
        ["node", SOLVER_JS, html_path, interstitial_url, target_url],
        capture_output=True, text=True, timeout=20,
        cwd="/home/ubuntu"
    )
    elapsed = time.time() - start
    print(f"  jsdom: {elapsed:.1f}s")
    
    if os.path.exists(payload_path):
        with open(payload_path) as f:
            return f.read()
    return None

def main():
    target_url = "https://www.truepeoplesearch.com/resultname?name=john%20smith&citystatezip=new%20york"
    
    # Find a proxy that gives us an interstitial challenge
    challenge = None
    session = None
    proxies = None
    
    for attempt in range(15):
        proxies, sid = make_proxy()
        session = cffi_requests.Session(impersonate="chrome131")
        
        resp = session.get(target_url, headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Upgrade-Insecure-Requests": "1",
        }, proxies=proxies, timeout=15)
        
        dd_match = re.search(r"var dd=(\{[^}]+\})", resp.text)
        if not dd_match:
            if attempt == 0:
                print(f"Attempt {attempt+1}: size={len(resp.text)} - no dd object")
            continue
        
        dd_str = dd_match.group(1).replace("'", '"')
        dd_obj = json.loads(dd_str)
        rt = dd_obj.get("rt", "")
        
        if rt == "i":
            print(f"Attempt {attempt+1}: Got interstitial challenge (session: {sid})")
            challenge = dd_obj
            challenge["cookie_val"] = session.cookies.get("datadome", "") or dd_obj.get("cookie", "")
            break
        else:
            print(f"Attempt {attempt+1}: rt={rt} (not interstitial)")
    
    if not challenge:
        print("Failed to get interstitial challenge")
        return
    
    cid = challenge["cid"]
    hsh = challenge["hsh"]
    cookie_val = challenge["cookie_val"]
    
    print(f"  cid: {cid[:40]}...")
    print(f"  hsh: {hsh}")
    print(f"  cookie: {cookie_val[:50]}...")
    
    # Fetch interstitial page
    print("\nFetching interstitial page...")
    referer_encoded = urllib.parse.quote(target_url)
    interstitial_url = (
        f"https://geo.captcha-delivery.com/interstitial/"
        f"?initialCid={urllib.parse.quote(cid)}"
        f"&hash={urllib.parse.quote(hsh)}"
        f"&cid={urllib.parse.quote(cookie_val)}"
        f"&s={challenge['s']}"
        f"&e={challenge.get('e', '')}"
        f"&b={challenge['b']}"
        f"&dm=cd"
        f"&referer={referer_encoded}"
    )
    
    resp2 = session.get(interstitial_url, headers={
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.truepeoplesearch.com/",
    }, proxies=proxies, timeout=15)
    
    print(f"  Status: {resp2.status_code} | Size: {len(resp2.text)}")
    
    if resp2.status_code != 200 or len(resp2.text) < 10000:
        print("  Failed!")
        return
    
    # Extract seed from the interstitial HTML
    seed_match = re.search(r"window\.ddm=\{[^}]*seed:'([^']+)'", resp2.text)
    seed = seed_match.group(1) if seed_match else "default"
    print(f"  seed: {seed}")
    
    # Run jsdom to get the POST body structure
    print("\nRunning jsdom solver...")
    jsdom_payload = run_jsdom_solver(resp2.text, interstitial_url, target_url)
    
    if not jsdom_payload:
        print("  Failed to capture payload!")
        return
    
    # Parse the jsdom payload
    params = urllib.parse.parse_qs(jsdom_payload, keep_blank_values=True)
    jsdom_payload_field = params.get("payload", [""])[0]
    print(f"  jsdom payload field: {len(jsdom_payload_field)} chars")
    
    # ============================================================
    # Strategy 1: Original jsdom payload (baseline)
    # ============================================================
    print("\n" + "=" * 60)
    print("Strategy 1: Original jsdom payload")
    print("=" * 60)
    
    resp3 = session.post("https://geo.captcha-delivery.com/interstitial/", data=jsdom_payload, headers={
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": "https://geo.captcha-delivery.com",
        "Referer": interstitial_url,
        "X-Requested-With": "XMLHttpRequest",
    }, proxies=proxies, timeout=15)
    
    try:
        data3 = json.loads(resp3.text)
        print(f"  View: {data3.get('view', '')}")
        if data3.get("view") == "redirect":
            print(f"  SUCCESS with original payload!")
            test_cookie(session, target_url, data3.get("cookie", ""), proxies)
            return
    except:
        print(f"  Response: {resp3.text[:200]}")
    
    # ============================================================
    # Strategy 2: jsdom payload without plv3
    # ============================================================
    print("\n" + "=" * 60)
    print("Strategy 2: jsdom payload without plv3")
    print("=" * 60)
    
    # Need fresh challenge for each attempt
    proxies2, sid2 = make_proxy()
    session2 = cffi_requests.Session(impersonate="chrome131")
    
    result2 = get_fresh_challenge_and_solve(session2, target_url, proxies2, modify_payload=remove_plv3)
    if result2 == "success":
        return
    
    # ============================================================
    # Strategy 3: Custom payload (encryptor library)
    # ============================================================
    print("\n" + "=" * 60)
    print("Strategy 3: Custom payload from encryptor library")
    print("=" * 60)
    
    proxies3, sid3 = make_proxy()
    session3 = cffi_requests.Session(impersonate="chrome131")
    
    result3 = get_fresh_challenge_and_solve(session3, target_url, proxies3, modify_payload=replace_with_custom_payload)
    if result3 == "success":
        return
    
    # ============================================================
    # Strategy 4: Custom payload without plv3
    # ============================================================
    print("\n" + "=" * 60)
    print("Strategy 4: Custom payload without plv3")
    print("=" * 60)
    
    proxies4, sid4 = make_proxy()
    session4 = cffi_requests.Session(impersonate="chrome131")
    
    result4 = get_fresh_challenge_and_solve(session4, target_url, proxies4, modify_payload=replace_and_remove_plv3)
    if result4 == "success":
        return
    
    print("\n" + "=" * 60)
    print("All strategies returned captcha")
    print("=" * 60)

def remove_plv3(payload_body, cid, hsh, seed):
    """Remove plv3 from payload"""
    params = urllib.parse.parse_qs(payload_body, keep_blank_values=True)
    if "plv3" in params:
        del params["plv3"]
    return urllib.parse.urlencode({k: v[0] for k, v in params.items()})

def replace_with_custom_payload(payload_body, cid, hsh, seed):
    """Replace payload field with custom-built one"""
    custom_payload = build_custom_payload(cid, hsh, seed)
    if not custom_payload:
        return payload_body
    
    params = urllib.parse.parse_qs(payload_body, keep_blank_values=True)
    params["payload"] = [custom_payload]
    print(f"  Custom payload: {len(custom_payload)} chars (was {len(params.get('payload', [''])[0])} chars)")
    return urllib.parse.urlencode({k: v[0] for k, v in params.items()})

def replace_and_remove_plv3(payload_body, cid, hsh, seed):
    """Replace payload and remove plv3"""
    custom_payload = build_custom_payload(cid, hsh, seed)
    if not custom_payload:
        return payload_body
    
    params = urllib.parse.parse_qs(payload_body, keep_blank_values=True)
    params["payload"] = [custom_payload]
    if "plv3" in params:
        del params["plv3"]
    print(f"  Custom payload: {len(custom_payload)} chars, plv3 removed")
    return urllib.parse.urlencode({k: v[0] for k, v in params.items()})

def get_fresh_challenge_and_solve(session, target_url, proxies, modify_payload=None):
    """Get a fresh challenge, solve it, optionally modify payload, and submit"""
    # Get challenge
    for attempt in range(10):
        resp = session.get(target_url, headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        }, proxies=proxies, timeout=15)
        
        dd_match = re.search(r"var dd=(\{[^}]+\})", resp.text)
        if dd_match:
            dd_str = dd_match.group(1).replace("'", '"')
            dd_obj = json.loads(dd_str)
            if dd_obj.get("rt") == "i":
                break
        
        if attempt < 9:
            proxies, _ = make_proxy()
            session = cffi_requests.Session(impersonate="chrome131")
    else:
        print("  Could not get interstitial challenge")
        return "failed"
    
    cid = dd_obj["cid"]
    hsh = dd_obj["hsh"]
    cookie_val = session.cookies.get("datadome", "") or dd_obj.get("cookie", "")
    
    # Fetch interstitial
    referer_encoded = urllib.parse.quote(target_url)
    interstitial_url = (
        f"https://geo.captcha-delivery.com/interstitial/"
        f"?initialCid={urllib.parse.quote(cid)}"
        f"&hash={urllib.parse.quote(hsh)}"
        f"&cid={urllib.parse.quote(cookie_val)}"
        f"&s={dd_obj['s']}&e={dd_obj.get('e', '')}&b={dd_obj['b']}&dm=cd"
        f"&referer={referer_encoded}"
    )
    
    resp2 = session.get(interstitial_url, headers={
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.truepeoplesearch.com/",
    }, proxies=proxies, timeout=15)
    
    if resp2.status_code != 200 or len(resp2.text) < 10000:
        print("  Failed to get interstitial page")
        return "failed"
    
    # Extract seed
    seed_match = re.search(r"window\.ddm=\{[^}]*seed:'([^']+)'", resp2.text)
    seed = seed_match.group(1) if seed_match else "default"
    
    # Solve with jsdom
    payload = run_jsdom_solver(resp2.text, interstitial_url, target_url)
    if not payload:
        print("  Failed to capture payload")
        return "failed"
    
    # Modify payload if needed
    if modify_payload:
        payload = modify_payload(payload, cid, hsh, seed)
    
    print(f"  Final payload: {len(payload)} bytes")
    
    # Submit
    resp3 = session.post("https://geo.captcha-delivery.com/interstitial/", data=payload, headers={
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": "https://geo.captcha-delivery.com",
        "Referer": interstitial_url,
        "X-Requested-With": "XMLHttpRequest",
    }, proxies=proxies, timeout=15)
    
    try:
        data = json.loads(resp3.text)
        view = data.get("view", "")
        print(f"  View: {view}")
        
        if view == "redirect":
            print(f"  SUCCESS!")
            test_cookie(session, target_url, data.get("cookie", ""), proxies)
            return "success"
        elif view == "captcha":
            print(f"  Captcha (bot detected)")
            return "captcha"
    except:
        print(f"  Response: {resp3.text[:200]}")
    
    return "failed"

def test_cookie(session, target_url, cookie_str, proxies):
    """Test if the cookie works"""
    dd_val = re.search(r"datadome=([^;]+)", cookie_str)
    if not dd_val:
        return
    
    time.sleep(0.5)
    resp = session.get(target_url, headers={
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Cookie": f"datadome={dd_val.group(1)}",
    }, proxies=proxies, timeout=15)
    
    print(f"  Test: status={resp.status_code} size={len(resp.text)}")
    if "data-detail-link" in resp.text:
        links = re.findall(r'data-detail-link="([^"]+)"', resp.text)
        print(f"  GOT {len(links)} RESULTS WITHOUT A BROWSER!")

if __name__ == "__main__":
    main()
