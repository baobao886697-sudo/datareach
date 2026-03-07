"""
End-to-end test v2: Bypass DataDome WITHOUT a browser
Tries multiple payload strategies:
1. Original jsdom payload (as-is)
2. jsdom payload with plv3 removed
3. jsdom payload with plv3 removed + empty fields removed
"""
import subprocess, json, re, random, time, os, urllib.parse
from curl_cffi import requests as cffi_requests

PROXY_USER = "baobao88667"
PROXY_PASS_BASE = "ib3itu0y152BDW0Scg1m"

def make_proxy():
    sid = str(random.randint(1000000, 9999999))
    pwd = f"{PROXY_PASS_BASE}_country-US_session-{sid}"
    proxy = f"http://{PROXY_USER}:{pwd}@core-residential.evomi.com:1000"
    return {"http": proxy, "https": proxy}, sid

def get_jsdom_solver_script(html_path, payload_path, cookie_path, interstitial_url, target_url):
    """Generate the Node.js solver script with improved mocks"""
    safe_interstitial_url = interstitial_url.replace("'", "\\'")
    safe_target_url = target_url.replace("'", "\\'")
    return f"""
const {{ JSDOM }} = require('/home/ubuntu/node_modules/jsdom');
const {{ createCanvas }} = require('/home/ubuntu/node_modules/@napi-rs/canvas');
const fs = require('fs');

const html = fs.readFileSync('{html_path}', 'utf-8');

const dom = new JSDOM(html, {{
    url: '{safe_interstitial_url}',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {{
        // Navigator
        const np = {{ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8, language: 'en-US', languages: Object.freeze(['en-US', 'en']), vendor: 'Google Inc.', maxTouchPoints: 0, cookieEnabled: true, doNotTrack: null, appCodeName: 'Mozilla', appName: 'Netscape', appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', product: 'Gecko', productSub: '20030107', vendorSub: '', webdriver: false }};
        for (const [k, v] of Object.entries(np)) {{ try {{ Object.defineProperty(window.navigator, k, {{ value: v, configurable: true, enumerable: true }}); }} catch(e) {{}} }}
        
        const pd = [{{ name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }}, {{ name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }}, {{ name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }}, {{ name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }}, {{ name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }}];
        const pl = {{ length: pd.length, item: (i) => pd[i] || null, namedItem: (n) => pd.find(p => p.name === n) || null, refresh: () => {{}} }};
        for (let i = 0; i < pd.length; i++) pl[i] = pd[i];
        try {{ Object.defineProperty(window.navigator, 'plugins', {{ value: pl, configurable: true }}); }} catch(e) {{}}
        try {{ Object.defineProperty(window.navigator, 'mimeTypes', {{ value: {{ length: 2, item: () => null, namedItem: () => null, 0: {{ type: 'application/pdf', suffixes: 'pdf', description: '' }}, 1: {{ type: 'text/pdf', suffixes: 'pdf', description: '' }} }}, configurable: true }}); }} catch(e) {{}}
        try {{ Object.defineProperty(window.navigator, 'connection', {{ value: {{ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }}, configurable: true }}); }} catch(e) {{}}
        window.navigator.getBattery = () => Promise.resolve({{ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, addEventListener: () => {{}} }});
        window.navigator.permissions = {{ query: () => Promise.resolve({{ state: 'prompt', onchange: null }}) }};

        // Screen
        Object.defineProperty(window, 'screen', {{ value: {{ width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24, orientation: {{ type: 'landscape-primary', angle: 0, addEventListener: () => {{}} }} }}, configurable: true }});
        for (const [k, v] of [['innerWidth', 1920], ['innerHeight', 969], ['outerWidth', 1920], ['outerHeight', 1040], ['devicePixelRatio', 1], ['screenX', 0], ['screenY', 0], ['screenLeft', 0], ['screenTop', 0]]) {{
            Object.defineProperty(window, k, {{ value: v, configurable: true }});
        }}

        // Performance
        const ps = Date.now();
        window.performance = window.performance || {{}};
        window.performance.now = () => Date.now() - ps;
        window.performance.timing = {{ navigationStart: ps, loadEventEnd: ps + 500, domContentLoadedEventEnd: ps + 300 }};
        window.performance.getEntriesByType = () => [];
        window.performance.getEntriesByName = () => [];
        window.performance.mark = () => {{}};
        window.performance.measure = () => {{}};

        // Canvas with real @napi-rs/canvas
        const origCE = window.document.createElement.bind(window.document);
        window.document.createElement = function(tag) {{
            const el = origCE(tag);
            if (tag.toLowerCase() === 'canvas') {{
                let _w = 300, _h = 150, rc = null;
                function getRC() {{ if (!rc || rc.width !== _w || rc.height !== _h) rc = createCanvas(_w, _h); return rc; }}
                Object.defineProperty(el, 'width', {{ get: () => _w, set: (v) => {{ _w = v; rc = null; }}, configurable: true }});
                Object.defineProperty(el, 'height', {{ get: () => _h, set: (v) => {{ _h = v; rc = null; }}, configurable: true }});
                el.getContext = function(type) {{
                    if (type === '2d') {{
                        const r = getRC().getContext('2d');
                        const h = {{ get(t, p) {{ if (typeof t[p] === 'function') return function(...a) {{ return t[p].apply(t, a); }}; return t[p]; }}, set(t, p, v) {{ t[p] = v; return true; }} }};
                        const px = new Proxy(r, h);
                        Object.defineProperty(px, 'canvas', {{ get: () => el, configurable: true }});
                        return px;
                    }}
                    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return mkGL(el);
                    return null;
                }};
                el.toDataURL = function(m) {{ return getRC().toDataURL(m || 'image/png'); }};
                el.toBlob = function(cb, m) {{ const d = getRC().toDataURL(m || 'image/png'); const b64 = d.split(',')[1]; const buf = Buffer.from(b64, 'base64'); cb(new Blob([buf], {{ type: m || 'image/png' }})); }};
            }}
            return el;
        }};

        function mkGL(c) {{
            const p = {{ 37445: 'Google Inc. (NVIDIA)', 37446: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)', 7938: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)', 7936: 'WebKit', 7937: 'WebKit WebGL', 3379: 16384, 34076: 16384, 3386: new Int32Array([32767, 32767]), 36347: 30, 36348: 16, 36349: 16, 35661: 16, 35660: 16, 34024: 16384, 35657: 16, 36345: 4096, 33901: new Float32Array([1, 1]), 33902: new Float32Array([1, 1024]), 3408: 8, 3410: 8, 3411: 8, 3412: 8, 3413: 8, 3414: 24, 35724: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)' }};
            const e = ['ANGLE_instanced_arrays','EXT_blend_minmax','EXT_color_buffer_half_float','EXT_float_blend','EXT_frag_depth','EXT_shader_texture_lod','EXT_texture_filter_anisotropic','EXT_sRGB','OES_element_index_uint','OES_standard_derivatives','OES_texture_float','OES_texture_float_linear','OES_texture_half_float','OES_texture_half_float_linear','OES_vertex_array_object','WEBGL_color_buffer_float','WEBGL_compressed_texture_s3tc','WEBGL_compressed_texture_s3tc_srgb','WEBGL_debug_renderer_info','WEBGL_debug_shaders','WEBGL_depth_texture','WEBGL_draw_buffers','WEBGL_lose_context','WEBGL_multi_draw'];
            return {{ getParameter: (k) => p[k] !== undefined ? p[k] : null, getExtension: (n) => {{ if (n === 'WEBGL_debug_renderer_info') return {{ UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 }}; if (n === 'EXT_texture_filter_anisotropic') return {{ MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 }}; if (e.includes(n)) return {{}}; return null; }}, getSupportedExtensions: () => e, createBuffer: () => ({{}}), bindBuffer: () => {{}}, bufferData: () => {{}}, createProgram: () => ({{}}), createShader: () => ({{}}), shaderSource: () => {{}}, compileShader: () => {{}}, getShaderParameter: () => true, attachShader: () => {{}}, linkProgram: () => {{}}, getProgramParameter: () => true, useProgram: () => {{}}, getAttribLocation: () => 0, enableVertexAttribArray: () => {{}}, vertexAttribPointer: () => {{}}, drawArrays: () => {{}}, drawElements: () => {{}}, viewport: () => {{}}, clearColor: () => {{}}, clear: () => {{}}, enable: () => {{}}, disable: () => {{}}, blendFunc: () => {{}}, depthFunc: () => {{}}, createTexture: () => ({{}}), bindTexture: () => {{}}, texImage2D: () => {{}}, texParameteri: () => {{}}, activeTexture: () => {{}}, createFramebuffer: () => ({{}}), bindFramebuffer: () => {{}}, framebufferTexture2D: () => {{}}, checkFramebufferStatus: () => 36053, readPixels: (x,y,w,h,f,t,px) => {{ if (px) for (let i = 0; i < px.length; i++) px[i] = (i*17+42)&0xFF; }}, getUniformLocation: () => ({{}}), uniform1f: () => {{}}, uniform1i: () => {{}}, uniform2f: () => {{}}, uniform3f: () => {{}}, uniform4f: () => {{}}, uniformMatrix4fv: () => {{}}, deleteShader: () => {{}}, deleteProgram: () => {{}}, deleteBuffer: () => {{}}, deleteTexture: () => {{}}, deleteFramebuffer: () => {{}}, getError: () => 0, pixelStorei: () => {{}}, generateMipmap: () => {{}}, isContextLost: () => false, canvas: c, drawingBufferWidth: 300, drawingBufferHeight: 150 }};
        }}

        // Audio
        class MAC {{ constructor() {{ this.sampleRate = 44100; this.state = 'running'; this.destination = {{ numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2 }}; this.currentTime = 0; }} createOscillator() {{ return {{ type: 'sine', frequency: {{ value: 440, setValueAtTime: () => {{}} }}, connect: () => {{}}, start: () => {{}}, stop: () => {{}}, disconnect: () => {{}} }}; }} createDynamicsCompressor() {{ return {{ threshold: {{ value: -24 }}, knee: {{ value: 30 }}, ratio: {{ value: 12 }}, attack: {{ value: 0.003 }}, release: {{ value: 0.25 }}, reduction: {{ value: 0 }}, connect: () => {{}}, disconnect: () => {{}} }}; }} createAnalyser() {{ return {{ fftSize: 2048, frequencyBinCount: 1024, connect: () => {{}}, disconnect: () => {{}} }}; }} createGain() {{ return {{ gain: {{ value: 1, setValueAtTime: () => {{}} }}, connect: () => {{}}, disconnect: () => {{}} }}; }} createBiquadFilter() {{ return {{ type: 'lowpass', frequency: {{ value: 350, setValueAtTime: () => {{}} }}, Q: {{ value: 1 }}, gain: {{ value: 0 }}, connect: () => {{}}, disconnect: () => {{}} }}; }} createScriptProcessor() {{ return {{ connect: () => {{}}, disconnect: () => {{}}, onaudioprocess: null, bufferSize: 4096 }}; }} createBufferSource() {{ return {{ buffer: null, connect: () => {{}}, start: () => {{}}, stop: () => {{}}, disconnect: () => {{}} }}; }} createBuffer(c, l, s) {{ return {{ numberOfChannels: c, length: l, sampleRate: s, getChannelData: () => new Float32Array(l), duration: l / s }}; }} close() {{ return Promise.resolve(); }} resume() {{ return Promise.resolve(); }} }}
        window.AudioContext = MAC;
        window.webkitAudioContext = MAC;
        window.OfflineAudioContext = class extends MAC {{ constructor(c, l, s) {{ super(); this.length = l; }} startRendering() {{ return Promise.resolve({{ numberOfChannels: 1, length: this.length || 44100, sampleRate: 44100, getChannelData: () => {{ const d = new Float32Array(this.length || 44100); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.001) * 0.0001; return d; }}, duration: (this.length || 44100) / 44100 }}); }} }};
        window.webkitOfflineAudioContext = window.OfflineAudioContext;

        // Misc
        if (!window.WebAssembly) window.WebAssembly = {{ instantiate: () => Promise.resolve({{ instance: {{ exports: {{}} }} }}), compile: () => Promise.resolve({{}}), validate: () => true }};
        if (!window.Intl) window.Intl = {{}};
        window.Intl.DateTimeFormat = function() {{ return {{ resolvedOptions: () => ({{ timeZone: 'America/New_York', locale: 'en-US' }}), format: (d) => new Date(d).toLocaleDateString('en-US') }}; }};
        window.requestAnimationFrame = (cb) => setTimeout(cb, 16);
        window.cancelAnimationFrame = (id) => clearTimeout(id);
        window.matchMedia = (q) => ({{ matches: false, media: q, onchange: null, addListener: () => {{}}, removeListener: () => {{}}, addEventListener: () => {{}}, removeEventListener: () => {{}}, dispatchEvent: () => false }});
        window.speechSynthesis = {{ getVoices: () => [], speak: () => {{}}, cancel: () => {{}}, pending: false, speaking: false, paused: false }};
        window.Notification = {{ permission: 'default' }};
        window.chrome = {{ runtime: {{}}, loadTimes: () => ({{}}), csi: () => ({{}}), app: {{ isInstalled: false }} }};

        // XHR Intercept
        const OrigXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {{
            const xhr = new OrigXHR();
            const oo = xhr.open.bind(xhr), os = xhr.send.bind(xhr), oh = xhr.setRequestHeader.bind(xhr);
            let _u = '';
            xhr.open = function(m, u, a) {{ _u = u; return oo(m, u, a); }};
            xhr.setRequestHeader = function(n, v) {{ return oh(n, v); }};
            xhr.send = function(body) {{
                if (body && _u.includes('interstitial')) {{
                    fs.writeFileSync('{payload_path}', body);
                    console.log('PAYLOAD_CAPTURED:' + body.length);
                }}
                return os(body);
            }};
            return xhr;
        }};

        window.parent = {{
            postMessage: function(data) {{ try {{ const p = JSON.parse(data); if (p.cookie) {{ fs.writeFileSync('{cookie_path}', p.cookie); console.log('COOKIE_CAPTURED'); }} }} catch(e) {{}} }},
            location: {{ href: '{safe_target_url}' }}
        }};
    }}
}});

setTimeout(() => {{ dom.window.close(); process.exit(0); }}, 10000);
"""


def run_jsdom(interstitial_html, interstitial_url, target_url):
    """Execute DataDome challenge JS in jsdom and return captured payload"""
    html_path = "/tmp/dd_challenge.html"
    payload_path = "/tmp/dd_payload.txt"
    cookie_path = "/tmp/dd_cookie.txt"
    script_path = "/tmp/dd_solver_v2.js"
    
    with open(html_path, "w") as f:
        f.write(interstitial_html)
    
    for p in [payload_path, cookie_path]:
        if os.path.exists(p):
            os.remove(p)
    
    script = get_jsdom_solver_script(html_path, payload_path, cookie_path, interstitial_url, target_url)
    with open(script_path, "w") as f:
        f.write(script)
    
    start = time.time()
    result = subprocess.run(
        ["node", script_path],
        capture_output=True, text=True, timeout=20,
        cwd="/home/ubuntu"
    )
    elapsed = time.time() - start
    
    print(f"  jsdom execution: {elapsed:.1f}s")
    if result.stdout:
        for line in result.stdout.strip().split('\n')[:5]:
            if line.strip():
                print(f"  stdout: {line.strip()}")
    if result.stderr:
        for line in result.stderr.strip().split('\n')[:3]:
            if line.strip() and 'Not implemented' not in line:
                print(f"  stderr: {line.strip()}")
    
    if os.path.exists(payload_path):
        with open(payload_path) as f:
            return f.read()
    return None


def submit_payload(session, payload_body, interstitial_url, proxies, label=""):
    """Submit payload to DataDome and return the response"""
    print(f"\n  [{label}] Submitting payload ({len(payload_body)} bytes)...")
    
    resp = session.post(
        "https://geo.captcha-delivery.com/interstitial/",
        data=payload_body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": "https://geo.captcha-delivery.com",
            "Referer": interstitial_url,
            "X-Requested-With": "XMLHttpRequest",
        },
        proxies=proxies, timeout=15,
    )
    
    print(f"  [{label}] Status: {resp.status_code}")
    
    if resp.status_code == 200:
        try:
            data = json.loads(resp.text)
            view = data.get("view", "")
            print(f"  [{label}] View: {view}")
            
            if view == "redirect":
                cookie = data.get("cookie", "")
                print(f"  [{label}] GOT VALID COOKIE: {cookie[:60]}...")
                return "redirect", cookie
            elif view == "captcha":
                print(f"  [{label}] Captcha requested (bot detected)")
                return "captcha", None
            else:
                print(f"  [{label}] Unknown view: {view}")
                return view, None
        except json.JSONDecodeError:
            print(f"  [{label}] Not JSON: {resp.text[:200]}")
            return "error", None
    else:
        print(f"  [{label}] HTTP {resp.status_code}: {resp.text[:200]}")
        return "error", None


def main():
    proxies, sid = make_proxy()
    session = cffi_requests.Session(impersonate="chrome131")
    
    try:
        ip_resp = session.get("https://api.ipify.org?format=json", proxies=proxies, timeout=10)
        print(f"Proxy IP: {ip_resp.json()['ip']} (session: {sid})")
    except Exception as e:
        print(f"Proxy check failed: {e}")
    
    target_url = "https://www.truepeoplesearch.com/resultname?name=john%20smith&citystatezip=new%20york"
    
    # ============================================================
    # STEP 1: Get challenge
    # ============================================================
    print("\n" + "=" * 60)
    print("STEP 1: Get DataDome challenge from TPS")
    print("=" * 60)
    
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
        if resp1.status_code == 200 and len(resp1.text) > 10000:
            print("Got 200 - not blocked! Page loaded directly.")
        else:
            print(f"Unexpected status: {resp1.status_code}")
        return
    
    dd_match = re.search(r"var dd=(\{[^}]+\})", resp1.text)
    if not dd_match:
        print("No dd object found!")
        print(f"Response preview: {resp1.text[:500]}")
        return
    
    dd_str = dd_match.group(1)
    cid = re.search(r"'cid':'([^']+)'", dd_str).group(1)
    hsh = re.search(r"'hsh':'([^']+)'", dd_str).group(1)
    b_val = re.search(r"'b':([\d]+)", dd_str).group(1)
    s_val = re.search(r"'s':([\d]+)", dd_str).group(1)
    
    # Get datadome cookie
    cookie_val = ""
    # Try from cookies jar
    try:
        dd_c = session.cookies.get('datadome')
        if dd_c:
            cookie_val = dd_c
    except:
        pass
    # Try from set-cookie header
    if not cookie_val:
        for h_name, h_val in resp1.headers.items():
            if h_name.lower() == 'set-cookie' and 'datadome=' in h_val:
                m = re.search(r'datadome=([^;]+)', h_val)
                if m:
                    cookie_val = m.group(1)
                    break
    # Try from response text
    if not cookie_val:
        cm = re.search(r"'cookie':'([^']+)'", dd_str)
        if cm:
            cookie_val = cm.group(1)
    
    print(f"cid: {cid[:40]}...")
    print(f"hsh: {hsh}")
    print(f"cookie: {cookie_val[:50]}...")
    
    # ============================================================
    # STEP 2: Fetch interstitial
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
    # STEP 3: Solve with jsdom
    # ============================================================
    print("\n" + "=" * 60)
    print("STEP 3: Solve challenge with jsdom")
    print("=" * 60)
    
    payload = run_jsdom(resp2.text, interstitial_url, target_url)
    
    if not payload:
        print("Failed to capture payload!")
        return
    
    print(f"  Payload captured: {len(payload)} bytes")
    params = urllib.parse.parse_qs(payload, keep_blank_values=True)
    for k, v in params.items():
        print(f"    {k}: {len(v[0])} chars")
    
    # ============================================================
    # STEP 4: Try submitting payload variants
    # ============================================================
    print("\n" + "=" * 60)
    print("STEP 4: Submit payload to DataDome")
    print("=" * 60)
    
    # Strategy 1: Original payload as-is
    view, cookie = submit_payload(session, payload, interstitial_url, proxies, "ORIGINAL")
    
    if view == "redirect" and cookie:
        test_cookie(session, target_url, cookie, proxies)
        return
    
    # Strategy 2: Remove plv3
    params_mod = urllib.parse.parse_qs(payload, keep_blank_values=True)
    if 'plv3' in params_mod:
        del params_mod['plv3']
    payload_no_plv3 = urllib.parse.urlencode({k: v[0] for k, v in params_mod.items()})
    
    # Need fresh session for retry
    proxies2, sid2 = make_proxy()
    session2 = cffi_requests.Session(impersonate="chrome131")
    
    # Re-do the full flow for strategy 2
    print("\n  [NO-PLV3] Getting fresh challenge...")
    resp1b = session2.get(target_url, headers={
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    }, proxies=proxies2, timeout=15)
    
    if resp1b.status_code == 403:
        dd_match_b = re.search(r"var dd=(\{[^}]+\})", resp1b.text)
        if dd_match_b:
            dd_str_b = dd_match_b.group(1)
            cid_b = re.search(r"'cid':'([^']+)'", dd_str_b).group(1)
            hsh_b = re.search(r"'hsh':'([^']+)'", dd_str_b).group(1)
            b_val_b = re.search(r"'b':([\d]+)", dd_str_b).group(1)
            s_val_b = re.search(r"'s':([\d]+)", dd_str_b).group(1)
            
            cookie_val_b = ""
            try:
                dd_c2 = session2.cookies.get('datadome')
                if dd_c2:
                    cookie_val_b = dd_c2
            except:
                pass
            if not cookie_val_b:
                for h_name, h_val in resp1b.headers.items():
                    if h_name.lower() == 'set-cookie' and 'datadome=' in h_val:
                        m = re.search(r'datadome=([^;]+)', h_val)
                        if m:
                            cookie_val_b = m.group(1)
                            break
            
            interstitial_url_b = (
                f"https://geo.captcha-delivery.com/interstitial/"
                f"?initialCid={urllib.parse.quote(cid_b)}"
                f"&hash={urllib.parse.quote(hsh_b)}"
                f"&cid={urllib.parse.quote(cookie_val_b)}"
                f"&s={s_val_b}"
                f"&b={b_val_b}"
                f"&dm=cd"
                f"&referer={referer_encoded}"
            )
            
            resp2b = session2.get(interstitial_url_b, headers={
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Referer": "https://www.truepeoplesearch.com/",
            }, proxies=proxies2, timeout=15)
            
            if resp2b.status_code == 200 and len(resp2b.text) > 10000:
                payload_b = run_jsdom(resp2b.text, interstitial_url_b, target_url)
                if payload_b:
                    # Remove plv3
                    params_b = urllib.parse.parse_qs(payload_b, keep_blank_values=True)
                    if 'plv3' in params_b:
                        del params_b['plv3']
                    payload_no_plv3_b = urllib.parse.urlencode({k: v[0] for k, v in params_b.items()})
                    
                    view2, cookie2 = submit_payload(session2, payload_no_plv3_b, interstitial_url_b, proxies2, "NO-PLV3")
                    
                    if view2 == "redirect" and cookie2:
                        test_cookie(session2, target_url, cookie2, proxies2)
                        return
    
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print("Both strategies returned captcha - fingerprint needs improvement")
    print("The jsdom environment is being detected as non-browser")


def test_cookie(session, target_url, cookie_str, proxies):
    """Test if the cookie works to access TPS"""
    print("\n" + "=" * 60)
    print("STEP 5: Test cookie on TPS")
    print("=" * 60)
    
    dd_val = re.search(r"datadome=([^;]+)", cookie_str)
    if not dd_val:
        print("Could not extract datadome value from cookie")
        return
    
    dd_cookie = dd_val.group(1)
    time.sleep(0.5)
    
    resp = session.get(
        target_url,
        headers={
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Cookie": f"datadome={dd_cookie}",
            "Referer": "https://www.truepeoplesearch.com/",
        },
        proxies=proxies, timeout=15,
    )
    
    print(f"Status: {resp.status_code} | Size: {len(resp.text)}")
    
    has_results = "data-detail-link" in resp.text
    if has_results:
        links = re.findall(r'data-detail-link="([^"]+)"', resp.text)
        print(f"\nSUCCESS! Got {len(links)} search results WITHOUT A BROWSER!")
    else:
        print(f"Cookie did not work. Response: {resp.text[:300]}")


if __name__ == "__main__":
    main()
