#!/usr/bin/env python3
"""
Playwright-based DataDome Interstitial Solver

Uses a real Chromium browser (via Playwright) to solve the DataDome
interstitial challenge. The browser runs through a residential proxy
and produces a valid datadome cookie.

Flow:
1. curl_cffi GET to target -> get dd object with interstitial params
2. Playwright opens interstitial URL through proxy
3. Real browser solves the challenge (fingerprint + VM)
4. Extract datadome cookie from browser
5. Return cookie for use with curl_cffi

Usage:
    python3 playwright_solver.py [target_url]
"""
import sys
import re
import json
import time
import random
import urllib.parse
from curl_cffi import requests as cffi_requests
from playwright.sync_api import sync_playwright

PROXY_USER = 'baobao88667'
PROXY_PASS_BASE = 'ib3itu0y152BDW0Scg1m'

def make_proxy(session_id=None):
    """Create a residential proxy configuration"""
    sid = session_id or str(random.randint(1000000, 9999999))
    pwd = f'{PROXY_PASS_BASE}_country-US_session-{sid}'
    return {
        'server': f'http://core-residential.evomi.com:1000',
        'username': PROXY_USER,
        'password': pwd,
    }, sid

def make_curl_proxy(session_id):
    """Create proxy dict for curl_cffi using same session"""
    pwd = f'{PROXY_PASS_BASE}_country-US_session-{session_id}'
    proxy = f'http://{PROXY_USER}:{pwd}@core-residential.evomi.com:1000'
    return {'http': proxy, 'https': proxy}

def get_dd_challenge(target_url, proxies, max_attempts=10):
    """Get DataDome interstitial challenge from target URL"""
    for attempt in range(max_attempts):
        session = cffi_requests.Session(impersonate='chrome131')
        try:
            resp = session.get(target_url, headers={
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Upgrade-Insecure-Requests': '1',
            }, proxies=proxies, timeout=15)
            
            dd_match = re.search(r"var dd=(\{[^}]+\})", resp.text)
            if dd_match:
                dd_str = dd_match.group(1).replace("'", '"')
                dd_obj = json.loads(dd_str)
                if dd_obj.get('rt') == 'i':
                    cookie_val = session.cookies.get('datadome', '') or dd_obj.get('cookie', '')
                    return dd_obj, cookie_val
                else:
                    print(f"  Attempt {attempt+1}: got rt={dd_obj.get('rt', '')} (not interstitial)")
            else:
                print(f"  Attempt {attempt+1}: no dd object (size={len(resp.text)})")
        except Exception as e:
            print(f"  Attempt {attempt+1}: error: {e}")
    return None, None

def build_interstitial_url(dd_obj, cookie_val, target_url):
    """Build the interstitial URL from dd object"""
    referer_encoded = urllib.parse.quote(target_url)
    return (
        f"https://geo.captcha-delivery.com/interstitial/"
        f"?initialCid={urllib.parse.quote(dd_obj['cid'])}"
        f"&hash={urllib.parse.quote(dd_obj['hsh'])}"
        f"&cid={urllib.parse.quote(cookie_val)}"
        f"&s={dd_obj['s']}"
        f"&e={dd_obj.get('e', '')}"
        f"&b={dd_obj['b']}"
        f"&dm=cd"
        f"&referer={referer_encoded}"
    )

def solve_with_playwright(interstitial_url, target_url, proxy_config, timeout_ms=30000):
    """
    Use Playwright to solve the interstitial challenge in a real browser.
    Returns the datadome cookie value or None.
    """
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            proxy=proxy_config,
            args=[
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-features=IsolateOrigins,site-per-process',
            ]
        )
        
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080},
            locale='en-US',
            timezone_id='America/New_York',
        )
        
        # Add stealth scripts to hide automation
        context.add_init_script("""
            // Hide webdriver
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            
            // Hide automation
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
            delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
            
            // Chrome runtime
            window.chrome = {
                runtime: {},
                loadTimes: function() { return {}; },
                csi: function() { return {}; },
                app: { isInstalled: false }
            };
            
            // Permissions
            const originalQuery = window.navigator.permissions.query;
            window.navigator.permissions.query = (parameters) => (
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters)
            );
        """)
        
        page = context.new_page()
        
        # Track the interstitial POST response
        dd_cookie = None
        challenge_result = None
        
        def handle_response(response):
            nonlocal dd_cookie, challenge_result
            url = response.url
            if 'captcha-delivery.com/interstitial' in url and response.request.method == 'POST':
                try:
                    body = response.json()
                    challenge_result = body
                    view = body.get('view', '')
                    cookie_str = body.get('cookie', '')
                    print(f"  Challenge response: view={view}")
                    if cookie_str:
                        match = re.search(r'datadome=([^;]+)', cookie_str)
                        if match:
                            dd_cookie = match.group(1)
                            print(f"  Got cookie: {dd_cookie[:50]}...")
                except Exception as e:
                    print(f"  Error parsing response: {e}")
        
        page.on('response', handle_response)
        
        print(f"  Loading interstitial URL in browser...")
        try:
            page.goto(interstitial_url, wait_until='networkidle', timeout=timeout_ms)
        except Exception as e:
            print(f"  Navigation timeout/error: {e}")
        
        # Wait a bit for the challenge to complete
        if not dd_cookie:
            print(f"  Waiting for challenge to complete...")
            for i in range(10):
                time.sleep(1)
                if dd_cookie:
                    break
        
        # Also check cookies directly from the browser
        if not dd_cookie:
            cookies = context.cookies()
            for c in cookies:
                if c['name'] == 'datadome':
                    dd_cookie = c['value']
                    print(f"  Got cookie from browser: {dd_cookie[:50]}...")
                    break
        
        browser.close()
        return dd_cookie, challenge_result

def verify_cookie(target_url, dd_cookie, proxies):
    """Verify the cookie works by accessing the target URL"""
    session = cffi_requests.Session(impersonate='chrome131')
    session.cookies.set('datadome', dd_cookie, domain='.truepeoplesearch.com')
    
    resp = session.get(target_url, headers={
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
    }, proxies=proxies, timeout=15)
    
    return resp

def main():
    target_url = sys.argv[1] if len(sys.argv) > 1 else 'https://www.truepeoplesearch.com/resultname?name=john%20smith&citystatezip=new%20york'
    
    print("=" * 60)
    print("DataDome Interstitial Solver (Playwright + curl_cffi)")
    print("=" * 60)
    
    # Use same proxy session for consistency
    proxy_config, session_id = make_proxy()
    curl_proxies = make_curl_proxy(session_id)
    
    print(f"\nProxy session: {session_id}")
    
    # Step 1: Get challenge
    print(f"\n{'='*60}")
    print("STEP 1: Get DataDome challenge")
    print(f"{'='*60}")
    
    dd_obj, cookie_val = get_dd_challenge(target_url, curl_proxies)
    if not dd_obj:
        print("Failed to get interstitial challenge after all attempts")
        # Try with different proxy sessions
        for _ in range(5):
            proxy_config, session_id = make_proxy()
            curl_proxies = make_curl_proxy(session_id)
            dd_obj, cookie_val = get_dd_challenge(target_url, curl_proxies, max_attempts=3)
            if dd_obj:
                break
    
    if not dd_obj:
        print("FAILED: Could not get interstitial challenge")
        return
    
    print(f"  Got challenge: cid={dd_obj['cid'][:30]}... hsh={dd_obj['hsh']}")
    
    # Step 2: Build interstitial URL
    interstitial_url = build_interstitial_url(dd_obj, cookie_val, target_url)
    print(f"  Interstitial URL: {interstitial_url[:100]}...")
    
    # Step 3: Solve with Playwright
    print(f"\n{'='*60}")
    print("STEP 2: Solve challenge with Playwright (real browser)")
    print(f"{'='*60}")
    
    dd_cookie, challenge_result = solve_with_playwright(
        interstitial_url, target_url, proxy_config, timeout_ms=30000
    )
    
    if not dd_cookie:
        print("FAILED: Could not get datadome cookie from browser")
        if challenge_result:
            print(f"  Challenge result: {json.dumps(challenge_result)[:200]}")
        return
    
    view = challenge_result.get('view', '') if challenge_result else 'unknown'
    print(f"  Challenge view: {view}")
    print(f"  Cookie: {dd_cookie[:60]}...")
    
    # Step 4: Verify cookie
    print(f"\n{'='*60}")
    print("STEP 3: Verify cookie on target site")
    print(f"{'='*60}")
    
    resp = verify_cookie(target_url, dd_cookie, curl_proxies)
    print(f"  Status: {resp.status_code} | Size: {len(resp.text)}")
    
    if 'data-detail-link' in resp.text:
        links = re.findall(r'data-detail-link="([^"]+)"', resp.text)
        print(f"  SUCCESS! Got {len(links)} search results!")
        print(f"  First result: {links[0] if links else 'N/A'}")
    else:
        dd_match = re.search(r"var dd=(\{[^}]+\})", resp.text)
        if dd_match:
            dd_str = dd_match.group(1).replace("'", '"')
            dd_obj2 = json.loads(dd_str)
            print(f"  Got another challenge: rt={dd_obj2.get('rt', '')}")
        elif len(resp.text) > 100000:
            print(f"  Got captcha page ({len(resp.text)} bytes)")
        else:
            print(f"  Unknown response: {resp.text[:200]}")
    
    print(f"\n{'='*60}")
    print("DONE")
    print(f"{'='*60}")

if __name__ == '__main__':
    main()
