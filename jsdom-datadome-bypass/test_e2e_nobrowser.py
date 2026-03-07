"""
End-to-end test: Bypass DataDome WITHOUT a browser
Flow:
1. curl_cffi → TPS search page → get 403 + DataDome challenge params
2. curl_cffi → geo.captcha-delivery.com/interstitial/ → get challenge HTML
3. Node.js + jsdom → execute challenge JS → capture payload
4. curl_cffi → POST payload to geo.captcha-delivery.com/interstitial/ → get cookie
5. curl_cffi → TPS search page with cookie → get real data
"""
import subprocess, json, re, random, time, os, tempfile, urllib.parse
from curl_cffi import requests as cffi_requests

PROXY_USER = "baobao88667"
PROXY_PASS_BASE = "ib3itu0y152BDW0Scg1m"

def make_proxy():
    sid = str(random.randint(1000000, 9999999))
    pwd = f"{PROXY_PASS_BASE}_country-US_session-{sid}"
    proxy = f"http://{PROXY_USER}:{pwd}@core-residential.evomi.com:1000"
    return {"http": proxy, "https": proxy}

def solve_interstitial_with_jsdom(interstitial_html, interstitial_url):
    """Execute DataDome challenge JS in Node.js + jsdom, return the payload"""
    
    # Save the HTML to a temp file
    html_path = "/tmp/dd_challenge.html"
    with open(html_path, "w") as f:
        f.write(interstitial_html)
    
    payload_path = "/tmp/dd_payload.txt"
    cookie_path = "/tmp/dd_cookie.txt"
    
    # Remove old files
    for p in [payload_path, cookie_path]:
        if os.path.exists(p):
            os.remove(p)
    
    # Node.js script to execute the challenge
    node_script = f"""
const {{ JSDOM }} = require('/home/ubuntu/node_modules/jsdom');
const fs = require('fs');

const html = fs.readFileSync('{html_path}', 'utf-8');

const dom = new JSDOM(html, {{
    url: '{interstitial_url}',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {{
        // Mock navigator
        Object.defineProperty(window.navigator, 'userAgent', {{
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            configurable: true
        }});
        Object.defineProperty(window.navigator, 'platform', {{ value: 'Win32', configurable: true }});
        Object.defineProperty(window.navigator, 'hardwareConcurrency', {{ value: 8, configurable: true }});
        Object.defineProperty(window.navigator, 'deviceMemory', {{ value: 8, configurable: true }});
        Object.defineProperty(window.navigator, 'language', {{ value: 'en-US', configurable: true }});
        Object.defineProperty(window.navigator, 'languages', {{ value: ['en-US', 'en'], configurable: true }});
        Object.defineProperty(window.navigator, 'vendor', {{ value: 'Google Inc.', configurable: true }});
        Object.defineProperty(window.navigator, 'maxTouchPoints', {{ value: 0, configurable: true }});
        
        Object.defineProperty(window, 'screen', {{
            value: {{ width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24, orientation: {{ type: 'landscape-primary', angle: 0 }} }},
            configurable: true
        }});
        
        window.performance = window.performance || {{}};
        window.performance.now = () => Date.now();
        
        // Mock canvas
        const mockCtx2d = {{
            fillRect: () => {{}}, fillText: () => {{}},
            measureText: () => ({{ width: 10 }}),
            getImageData: () => ({{ data: new Uint8Array(100) }}),
            canvas: {{ toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }},
            font: '', fillStyle: '', textBaseline: '', strokeStyle: '', lineWidth: 1,
            beginPath: () => {{}}, arc: () => {{}}, stroke: () => {{}}, closePath: () => {{}},
            rect: () => {{}}, fill: () => {{}}, clip: () => {{}}, rotate: () => {{}}, translate: () => {{}},
            save: () => {{}}, restore: () => {{}}, scale: () => {{}}, setTransform: () => {{}},
            createLinearGradient: () => ({{ addColorStop: () => {{}} }}),
            drawImage: () => {{}},
        }};
        
        const mockWebGL = {{
            getParameter: (p) => {{
                if (p === 37445) return 'Google Inc. (NVIDIA)';
                if (p === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)';
                if (p === 7938) return 'WebGL 1.0 (OpenGL ES 2.0 Chromium)';
                if (p === 7936) return 'WebKit';
                if (p === 7937) return 'WebKit WebGL';
                return null;
            }},
            getExtension: (n) => {{
                if (n === 'WEBGL_debug_renderer_info') return {{ UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 }};
                return null;
            }},
            getSupportedExtensions: () => ['WEBGL_debug_renderer_info', 'EXT_texture_filter_anisotropic'],
            createBuffer: () => ({{}}), bindBuffer: () => {{}}, bufferData: () => {{}},
            createProgram: () => ({{}}), createShader: () => ({{}}), shaderSource: () => {{}},
            compileShader: () => {{}}, attachShader: () => {{}}, linkProgram: () => {{}},
            useProgram: () => {{}}, drawArrays: () => {{}}, getShaderParameter: () => true,
            getProgramParameter: () => true, getAttribLocation: () => 0,
            enableVertexAttribArray: () => {{}}, vertexAttribPointer: () => {{}},
            viewport: () => {{}}, clearColor: () => {{}}, clear: () => {{}},
            canvas: {{ toDataURL: () => 'data:image/png;base64,mockwebgl' }},
        }};
        
        const origCreateElement = window.document.createElement.bind(window.document);
        window.document.createElement = function(tag) {{
            const el = origCreateElement(tag);
            if (tag.toLowerCase() === 'canvas') {{
                el.getContext = function(type) {{
                    if (type === '2d') return mockCtx2d;
                    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return mockWebGL;
                    return null;
                }};
                el.toDataURL = () => 'data:image/png;base64,mock';
                el.width = 300; el.height = 150;
            }}
            return el;
        }};
        
        window.AudioContext = window.AudioContext || function() {{
            return {{
                createOscillator: () => ({{ connect: () => {{}}, start: () => {{}}, type: '', frequency: {{ value: 0 }} }}),
                createDynamicsCompressor: () => ({{ connect: () => {{}}, threshold: {{ value: 0 }}, knee: {{ value: 0 }}, ratio: {{ value: 0 }}, attack: {{ value: 0 }}, release: {{ value: 0 }} }}),
                createAnalyser: () => ({{ connect: () => {{}}, fftSize: 0, getFloatFrequencyData: () => {{}} }}),
                createGain: () => ({{ connect: () => {{}}, gain: {{ value: 0 }} }}),
                createBiquadFilter: () => ({{ connect: () => {{}}, type: '', frequency: {{ value: 0 }}, Q: {{ value: 0 }} }}),
                destination: {{}}, sampleRate: 44100, close: () => {{}},
                createScriptProcessor: () => ({{ connect: () => {{}}, onaudioprocess: null }}),
            }};
        }};
        window.webkitAudioContext = window.AudioContext;
        
        // Intercept XMLHttpRequest to capture payload
        const OrigXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {{
            const xhr = new OrigXHR();
            const origOpen = xhr.open.bind(xhr);
            const origSend = xhr.send.bind(xhr);
            
            xhr.open = function(method, url, async) {{
                this._url = url;
                this._method = method;
                return origOpen(method, url, async);
            }};
            
            xhr.send = function(body) {{
                if (body) {{
                    fs.writeFileSync('{payload_path}', body);
                    console.log('PAYLOAD_CAPTURED:' + body.length);
                }}
                return origSend(body);
            }};
            
            return xhr;
        }};
        
        // Mock parent
        window.parent = {{
            postMessage: function(data, origin) {{
                try {{
                    const parsed = JSON.parse(data);
                    if (parsed.cookie) {{
                        fs.writeFileSync('{cookie_path}', parsed.cookie);
                        console.log('COOKIE_CAPTURED');
                    }}
                }} catch(e) {{}}
            }},
            location: {{ href: 'https://www.truepeoplesearch.com/' }}
        }};
    }}
}});

// Wait for challenge to complete
setTimeout(() => {{
    process.exit(0);
}}, 8000);
"""
    
    script_path = "/tmp/dd_solver.js"
    with open(script_path, "w") as f:
        f.write(node_script)
    
    # Run Node.js
    start = time.time()
    result = subprocess.run(
        ["node", script_path],
        capture_output=True, text=True, timeout=15,
        cwd="/home/ubuntu"
    )
    elapsed = time.time() - start
    
    print(f"  jsdom execution: {elapsed:.1f}s")
    if result.stdout:
        print(f"  stdout: {result.stdout.strip()}")
    if result.stderr:
        print(f"  stderr: {result.stderr.strip()[:200]}")
    
    # Read captured payload
    payload = None
    if os.path.exists(payload_path):
        with open(payload_path) as f:
            payload = f.read()
        print(f"  Payload captured: {len(payload)} bytes")
    
    return payload


def main():
    proxies = make_proxy()
    session = cffi_requests.Session(impersonate="chrome142")
    
    # Verify proxy
    ip_resp = session.get("https://api.ipify.org?format=json", proxies=proxies, timeout=10)
    print(f"Proxy IP: {ip_resp.json()['ip']}")
    
    # ============================================================
    # STEP 1: Hit TPS search page → get 403 + challenge params
    # ============================================================
    print("\n" + "=" * 60)
    print("STEP 1: Get DataDome challenge from TPS")
    print("=" * 60)
    
    target_url = "https://www.truepeoplesearch.com/resultname?name=john%20smith&citystatezip=new%20york"
    
    resp1 = session.get(
        target_url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Upgrade-Insecure-Requests": "1",
        },
        proxies=proxies, timeout=15,
    )
    
    print(f"Status: {resp1.status_code} | Size: {len(resp1.text)}")
    
    if resp1.status_code != 403:
        print("Not blocked! Unexpected.")
        return
    
    # Parse dd object
    dd_match = re.search(r"var dd=(\{[^}]+\})", resp1.text)
    if not dd_match:
        print("No dd object found!")
        return
    
    dd_str = dd_match.group(1)
    cid = re.search(r"'cid':'([^']+)'", dd_str).group(1)
    hsh = re.search(r"'hsh':'([^']+)'", dd_str).group(1)
    b_val = re.search(r"'b':(\d+)", dd_str).group(1)
    s_val = re.search(r"'s':(\d+)", dd_str).group(1)
    e_val = re.search(r"'e':'([^']+)'", dd_str).group(1)
    cookie_val = re.search(r"'cookie':'([^']+)'", dd_str).group(1)
    
    print(f"Challenge params: cid={cid[:30]}... hsh={hsh}")
    
    # ============================================================
    # STEP 2: Fetch interstitial page
    # ============================================================
    print("\n" + "=" * 60)
    print("STEP 2: Fetch interstitial challenge page")
    print("=" * 60)
    
    referer_encoded = urllib.parse.quote(target_url)
    interstitial_url = (
        f"https://geo.captcha-delivery.com/interstitial/"
        f"?initialCid={urllib.parse.quote(cid)}"
        f"&hash={urllib.parse.quote(hsh)}"
        f"&cid={urllib.parse.quote(cookie_val)}"
        f"&s={s_val}"
        f"&e={e_val}"
        f"&b={b_val}"
        f"&dm=cd"
        f"&referer={referer_encoded}"
    )
    
    resp2 = session.get(
        interstitial_url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.truepeoplesearch.com/",
            "Sec-Fetch-Dest": "iframe",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "cross-site",
        },
        proxies=proxies, timeout=15,
    )
    
    print(f"Status: {resp2.status_code} | Size: {len(resp2.text)}")
    
    if resp2.status_code != 200 or len(resp2.text) < 10000:
        print("Failed to get interstitial page!")
        return
    
    # ============================================================
    # STEP 3: Solve challenge with jsdom
    # ============================================================
    print("\n" + "=" * 60)
    print("STEP 3: Solve challenge with Node.js + jsdom")
    print("=" * 60)
    
    payload = solve_interstitial_with_jsdom(resp2.text, interstitial_url)
    
    if not payload:
        print("Failed to capture payload!")
        return
    
    # ============================================================
    # STEP 4: POST payload to DataDome
    # ============================================================
    print("\n" + "=" * 60)
    print("STEP 4: POST payload to DataDome")
    print("=" * 60)
    
    resp3 = session.post(
        "https://geo.captcha-delivery.com/interstitial/",
        data=payload,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": "https://geo.captcha-delivery.com",
            "Referer": interstitial_url,
        },
        proxies=proxies, timeout=15,
    )
    
    print(f"Status: {resp3.status_code} | Size: {len(resp3.text)}")
    print(f"Response: {resp3.text[:500]}")
    
    if resp3.status_code == 200:
        try:
            data = json.loads(resp3.text)
            if data.get("view") == "redirect":
                cookie = data.get("cookie", "")
                print(f"\n🎉 GOT VALID COOKIE!")
                print(f"Cookie: {cookie[:80]}...")
                
                # Extract just the datadome value
                dd_val = re.search(r"datadome=([^;]+)", cookie)
                if dd_val:
                    dd_cookie = dd_val.group(1)
                    
                    # ============================================================
                    # STEP 5: Fetch TPS with the cookie
                    # ============================================================
                    print("\n" + "=" * 60)
                    print("STEP 5: Fetch TPS search page with cookie")
                    print("=" * 60)
                    
                    time.sleep(0.5)
                    
                    resp4 = session.get(
                        target_url,
                        headers={
                            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                            "Accept-Language": "en-US,en;q=0.9",
                            "Cookie": f"datadome={dd_cookie}",
                            "Referer": "https://www.truepeoplesearch.com/",
                            "Sec-Fetch-Dest": "document",
                            "Sec-Fetch-Mode": "navigate",
                            "Sec-Fetch-Site": "same-origin",
                            "Upgrade-Insecure-Requests": "1",
                        },
                        proxies=proxies, timeout=15,
                    )
                    
                    print(f"Status: {resp4.status_code} | Size: {len(resp4.text)}")
                    
                    has_results = "data-detail-link" in resp4.text
                    is_captcha = "captcha" in resp4.text.lower()[:2000]
                    
                    if has_results:
                        links = re.findall(r'data-detail-link="([^"]+)"', resp4.text)
                        print(f"\n🎉🎉🎉 SUCCESS! Got {len(links)} search results WITHOUT A BROWSER! 🎉🎉🎉")
                    elif is_captcha:
                        print("❌ Still captcha")
                    else:
                        print(f"Other: {resp4.text[:300]}")
                        
            elif data.get("view") == "captcha":
                print("❌ DataDome wants captcha (fingerprint not good enough)")
            else:
                print(f"Unknown view: {data.get('view')}")
        except json.JSONDecodeError:
            print("Response is not JSON")
    else:
        print(f"POST failed with status {resp3.status_code}")


if __name__ == "__main__":
    main()
