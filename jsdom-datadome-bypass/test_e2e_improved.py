"""
End-to-end test: Bypass DataDome WITHOUT a browser (IMPROVED)
Uses @napi-rs/canvas for real Canvas 2D rendering and comprehensive mocks.

Flow:
1. curl_cffi → TPS search page → get 403 + DataDome challenge params
2. curl_cffi → geo.captcha-delivery.com/interstitial/ → get challenge HTML
3. Node.js + jsdom + @napi-rs/canvas → execute challenge JS → capture payload
4. curl_cffi → POST payload to geo.captcha-delivery.com/interstitial/ → get cookie
5. curl_cffi → TPS search page with cookie → get real data
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

def solve_interstitial_with_jsdom(interstitial_html, interstitial_url, target_url):
    """Execute DataDome challenge JS in Node.js + jsdom with improved mocks"""
    
    html_path = "/tmp/dd_challenge.html"
    with open(html_path, "w") as f:
        f.write(interstitial_html)
    
    payload_path = "/tmp/dd_payload.txt"
    cookie_path = "/tmp/dd_cookie.txt"
    
    for p in [payload_path, cookie_path]:
        if os.path.exists(p):
            os.remove(p)
    
    # Escape the URLs for embedding in JS
    interstitial_url_escaped = interstitial_url.replace("'", "\\'")
    target_url_escaped = target_url.replace("'", "\\'")
    
    node_script = """
const { JSDOM } = require('/home/ubuntu/node_modules/jsdom');
const { createCanvas } = require('/home/ubuntu/node_modules/@napi-rs/canvas');
const fs = require('fs');

const html = fs.readFileSync('""" + html_path + """', 'utf-8');

const dom = new JSDOM(html, {
    url: '""" + interstitial_url_escaped + """',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
        // ==================== Navigator ====================
        const navProps = {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            platform: 'Win32', hardwareConcurrency: 8, deviceMemory: 8,
            language: 'en-US', languages: Object.freeze(['en-US', 'en']),
            vendor: 'Google Inc.', maxTouchPoints: 0, cookieEnabled: true,
            doNotTrack: null, appCodeName: 'Mozilla', appName: 'Netscape',
            appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            product: 'Gecko', productSub: '20030107', vendorSub: '', webdriver: false,
        };
        for (const [k, v] of Object.entries(navProps)) {
            try { Object.defineProperty(window.navigator, k, { value: v, configurable: true, enumerable: true }); } catch(e) {}
        }
        
        // Plugins (Chrome default 5)
        const pluginData = [
            { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        ];
        const plugins = { length: pluginData.length, item: (i) => pluginData[i] || null, namedItem: (n) => pluginData.find(p => p.name === n) || null, refresh: () => {} };
        for (let i = 0; i < pluginData.length; i++) plugins[i] = pluginData[i];
        try { Object.defineProperty(window.navigator, 'plugins', { value: plugins, configurable: true }); } catch(e) {}
        try { Object.defineProperty(window.navigator, 'mimeTypes', { value: { length: 2, item: () => null, namedItem: () => null, 0: { type: 'application/pdf', suffixes: 'pdf', description: '' }, 1: { type: 'text/pdf', suffixes: 'pdf', description: '' } }, configurable: true }); } catch(e) {}
        try { Object.defineProperty(window.navigator, 'connection', { value: { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }, configurable: true }); } catch(e) {}
        window.navigator.getBattery = () => Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, addEventListener: () => {} });
        window.navigator.permissions = { query: () => Promise.resolve({ state: 'prompt', onchange: null }) };

        // ==================== Screen ====================
        Object.defineProperty(window, 'screen', { value: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24, orientation: { type: 'landscape-primary', angle: 0, addEventListener: () => {} } }, configurable: true });
        for (const [k, v] of [['innerWidth', 1920], ['innerHeight', 969], ['outerWidth', 1920], ['outerHeight', 1040], ['devicePixelRatio', 1], ['screenX', 0], ['screenY', 0], ['screenLeft', 0], ['screenTop', 0]]) {
            Object.defineProperty(window, k, { value: v, configurable: true });
        }

        // ==================== Performance ====================
        const perfStart = Date.now();
        window.performance = window.performance || {};
        window.performance.now = () => Date.now() - perfStart;
        window.performance.timing = { navigationStart: perfStart, loadEventEnd: perfStart + 500, domContentLoadedEventEnd: perfStart + 300 };
        window.performance.getEntriesByType = () => [];
        window.performance.getEntriesByName = () => [];
        window.performance.mark = () => {};
        window.performance.measure = () => {};

        // ==================== Canvas (REAL @napi-rs/canvas for 2D) ====================
        const origCE = window.document.createElement.bind(window.document);
        window.document.createElement = function(tag) {
            const el = origCE(tag);
            if (tag.toLowerCase() === 'canvas') {
                let _w = 300, _h = 150, rc = null;
                function getRC() { if (!rc || rc.width !== _w || rc.height !== _h) rc = createCanvas(_w, _h); return rc; }
                Object.defineProperty(el, 'width', { get: () => _w, set: (v) => { _w = v; rc = null; }, configurable: true });
                Object.defineProperty(el, 'height', { get: () => _h, set: (v) => { _h = v; rc = null; }, configurable: true });
                el.getContext = function(type) {
                    if (type === '2d') {
                        const r = getRC().getContext('2d');
                        const h = { get(t, p) { if (typeof t[p] === 'function') return function(...a) { return t[p].apply(t, a); }; return t[p]; }, set(t, p, v) { t[p] = v; return true; } };
                        const px = new Proxy(r, h);
                        Object.defineProperty(px, 'canvas', { get: () => el, configurable: true });
                        return px;
                    }
                    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return mkGL(el);
                    return null;
                };
                el.toDataURL = function(m) { return getRC().toDataURL(m || 'image/png'); };
                el.toBlob = function(cb, m) {
                    const d = getRC().toDataURL(m || 'image/png');
                    const b64 = d.split(',')[1];
                    const buf = Buffer.from(b64, 'base64');
                    cb(new Blob([buf], { type: m || 'image/png' }));
                };
            }
            return el;
        };

        function mkGL(c) {
            const p = { 37445: 'Google Inc. (NVIDIA)', 37446: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)', 7938: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)', 7936: 'WebKit', 7937: 'WebKit WebGL', 3379: 16384, 34076: 16384, 3386: new Int32Array([32767, 32767]), 36347: 30, 36348: 16, 36349: 16, 35661: 16, 35660: 16, 34024: 16384, 35657: 16, 36345: 4096, 33901: new Float32Array([1, 1]), 33902: new Float32Array([1, 1024]), 3408: 8, 3410: 8, 3411: 8, 3412: 8, 3413: 8, 3414: 24, 35724: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)' };
            const e = ['ANGLE_instanced_arrays','EXT_blend_minmax','EXT_color_buffer_half_float','EXT_float_blend','EXT_frag_depth','EXT_shader_texture_lod','EXT_texture_filter_anisotropic','EXT_sRGB','OES_element_index_uint','OES_standard_derivatives','OES_texture_float','OES_texture_float_linear','OES_texture_half_float','OES_texture_half_float_linear','OES_vertex_array_object','WEBGL_color_buffer_float','WEBGL_compressed_texture_s3tc','WEBGL_compressed_texture_s3tc_srgb','WEBGL_debug_renderer_info','WEBGL_debug_shaders','WEBGL_depth_texture','WEBGL_draw_buffers','WEBGL_lose_context','WEBGL_multi_draw'];
            return { getParameter: (k) => p[k] !== undefined ? p[k] : null, getExtension: (n) => { if (n === 'WEBGL_debug_renderer_info') return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 }; if (n === 'EXT_texture_filter_anisotropic') return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 }; if (e.includes(n)) return {}; return null; }, getSupportedExtensions: () => e, createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {}, createProgram: () => ({}), createShader: () => ({}), shaderSource: () => {}, compileShader: () => {}, getShaderParameter: () => true, attachShader: () => {}, linkProgram: () => {}, getProgramParameter: () => true, useProgram: () => {}, getAttribLocation: () => 0, enableVertexAttribArray: () => {}, vertexAttribPointer: () => {}, drawArrays: () => {}, drawElements: () => {}, viewport: () => {}, clearColor: () => {}, clear: () => {}, enable: () => {}, disable: () => {}, blendFunc: () => {}, depthFunc: () => {}, createTexture: () => ({}), bindTexture: () => {}, texImage2D: () => {}, texParameteri: () => {}, activeTexture: () => {}, createFramebuffer: () => ({}), bindFramebuffer: () => {}, framebufferTexture2D: () => {}, checkFramebufferStatus: () => 36053, readPixels: (x,y,w,h,f,t,px) => { if (px) for (let i = 0; i < px.length; i++) px[i] = (i*17+42)&0xFF; }, getUniformLocation: () => ({}), uniform1f: () => {}, uniform1i: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {}, uniformMatrix4fv: () => {}, deleteShader: () => {}, deleteProgram: () => {}, deleteBuffer: () => {}, deleteTexture: () => {}, deleteFramebuffer: () => {}, getError: () => 0, pixelStorei: () => {}, generateMipmap: () => {}, isContextLost: () => false, canvas: c, drawingBufferWidth: 300, drawingBufferHeight: 150 };
        }

        // ==================== Audio ====================
        class MAC { constructor() { this.sampleRate = 44100; this.state = 'running'; this.destination = { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2 }; this.currentTime = 0; } createOscillator() { return { type: 'sine', frequency: { value: 440, setValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {}, disconnect: () => {} }; } createDynamicsCompressor() { return { threshold: { value: -24 }, knee: { value: 30 }, ratio: { value: 12 }, attack: { value: 0.003 }, release: { value: 0.25 }, reduction: { value: 0 }, connect: () => {}, disconnect: () => {} }; } createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, connect: () => {}, disconnect: () => {} }; } createGain() { return { gain: { value: 1, setValueAtTime: () => {} }, connect: () => {}, disconnect: () => {} }; } createBiquadFilter() { return { type: 'lowpass', frequency: { value: 350, setValueAtTime: () => {} }, Q: { value: 1 }, gain: { value: 0 }, connect: () => {}, disconnect: () => {} }; } createScriptProcessor() { return { connect: () => {}, disconnect: () => {}, onaudioprocess: null, bufferSize: 4096 }; } createBufferSource() { return { buffer: null, connect: () => {}, start: () => {}, stop: () => {}, disconnect: () => {} }; } createBuffer(c, l, s) { return { numberOfChannels: c, length: l, sampleRate: s, getChannelData: () => new Float32Array(l), duration: l / s }; } close() { return Promise.resolve(); } resume() { return Promise.resolve(); } }
        window.AudioContext = MAC;
        window.webkitAudioContext = MAC;
        window.OfflineAudioContext = class extends MAC { constructor(c, l, s) { super(); this.length = l; } startRendering() { return Promise.resolve({ numberOfChannels: 1, length: this.length || 44100, sampleRate: 44100, getChannelData: () => { const d = new Float32Array(this.length || 44100); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.001) * 0.0001; return d; }, duration: (this.length || 44100) / 44100 }); } };
        window.webkitOfflineAudioContext = window.OfflineAudioContext;

        // ==================== Misc Browser APIs ====================
        if (!window.WebAssembly) window.WebAssembly = { instantiate: () => Promise.resolve({ instance: { exports: {} } }), compile: () => Promise.resolve({}), validate: () => true };
        if (!window.Intl) window.Intl = {};
        window.Intl.DateTimeFormat = function() { return { resolvedOptions: () => ({ timeZone: 'America/New_York', locale: 'en-US' }), format: (d) => new Date(d).toLocaleDateString('en-US') }; };
        window.requestAnimationFrame = (cb) => setTimeout(cb, 16);
        window.cancelAnimationFrame = (id) => clearTimeout(id);
        window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false });
        window.speechSynthesis = { getVoices: () => [], speak: () => {}, cancel: () => {}, pending: false, speaking: false, paused: false };
        window.Notification = { permission: 'default' };
        window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: { isInstalled: false } };

        // ==================== XHR Intercept ====================
        const OrigXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            const xhr = new OrigXHR();
            const oo = xhr.open.bind(xhr), os = xhr.send.bind(xhr), oh = xhr.setRequestHeader.bind(xhr);
            let _u = '';
            xhr.open = function(m, u, a) { _u = u; return oo(m, u, a); };
            xhr.setRequestHeader = function(n, v) { return oh(n, v); };
            xhr.send = function(body) {
                if (body && _u.includes('interstitial')) {
                    fs.writeFileSync('""" + payload_path + """', body);
                    console.log('PAYLOAD_CAPTURED:' + body.length);
                }
                return os(body);
            };
            return xhr;
        };

        // ==================== Parent mock ====================
        window.parent = {
            postMessage: function(data) {
                try {
                    const p = JSON.parse(data);
                    if (p.cookie) {
                        fs.writeFileSync('""" + cookie_path + """', p.cookie);
                        console.log('COOKIE_CAPTURED');
                    }
                } catch(e) {}
            },
            location: { href: '""" + target_url_escaped + """' }
        };
    }
});

setTimeout(() => { dom.window.close(); process.exit(0); }, 10000);
"""
    
    script_path = "/tmp/dd_solver_improved.js"
    with open(script_path, "w") as f:
        f.write(node_script)
    
    start = time.time()
    result = subprocess.run(
        ["node", script_path],
        capture_output=True, text=True, timeout=20,
        cwd="/home/ubuntu"
    )
    elapsed = time.time() - start
    
    print(f"  jsdom execution: {elapsed:.1f}s")
    if result.stdout:
        for line in result.stdout.strip().split('\n'):
            if line.strip():
                print(f"  stdout: {line.strip()}")
    if result.stderr:
        for line in result.stderr.strip().split('\n')[:5]:
            if line.strip():
                print(f"  stderr: {line.strip()}")
    
    payload = None
    if os.path.exists(payload_path):
        with open(payload_path) as f:
            payload = f.read()
        print(f"  Payload captured: {len(payload)} bytes")
        
        # Show payload structure
        params = urllib.parse.parse_qs(payload)
        for key in params:
            print(f"    {key}: {len(params[key][0])} chars")
    
    return payload


def main():
    proxies, sid = make_proxy()
    session = cffi_requests.Session(impersonate="chrome131")
    
    # Verify proxy
    try:
        ip_resp = session.get("https://api.ipify.org?format=json", proxies=proxies, timeout=10)
        print(f"Proxy IP: {ip_resp.json()['ip']} (session: {sid})")
    except Exception as e:
        print(f"Proxy check failed: {e}")
    
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
    b_val = re.search(r"'b':([\d]+)", dd_str).group(1)
    s_val = re.search(r"'s':([\d]+)", dd_str).group(1)
    
    # Get datadome cookie from set-cookie header or dd object
    cookie_val = ""
    # Try set-cookie header first
    for h_name, h_val in resp1.headers.items():
        if h_name.lower() == 'set-cookie' and 'datadome=' in h_val:
            dd_match2 = re.search(r'datadome=([^;]+)', h_val)
            if dd_match2:
                cookie_val = dd_match2.group(1)
                break
    # Fallback to dd object
    if not cookie_val:
        cookie_match = re.search(r"'cookie':'([^']+)'", dd_str)
        if cookie_match:
            cookie_val = cookie_match.group(1)
    # Fallback to session cookies
    if not cookie_val:
        for cookie in session.cookies:
            if cookie.name == 'datadome':
                cookie_val = cookie.value
                break
    
    print(f"Challenge params: cid={cid[:30]}... hsh={hsh}")
    print(f"DataDome cookie: {cookie_val[:50]}...")
    
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
    print("STEP 3: Solve challenge with Node.js + jsdom + @napi-rs/canvas")
    print("=" * 60)
    
    payload = solve_interstitial_with_jsdom(resp2.text, interstitial_url, target_url)
    
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
            "X-Requested-With": "XMLHttpRequest",
        },
        proxies=proxies, timeout=15,
    )
    
    print(f"Status: {resp3.status_code} | Size: {len(resp3.text)}")
    print(f"Response: {resp3.text[:500]}")
    
    if resp3.status_code == 200:
        try:
            data = json.loads(resp3.text)
            view = data.get("view", "")
            print(f"View: {view}")
            
            if view == "redirect":
                cookie = data.get("cookie", "")
                print(f"\nGOT VALID COOKIE!")
                print(f"Cookie: {cookie[:80]}...")
                
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
                        print(f"\nSUCCESS! Got {len(links)} search results WITHOUT A BROWSER!")
                    elif is_captcha:
                        print("Still captcha - fingerprint not good enough")
                    else:
                        print(f"Other response: {resp4.text[:300]}")
                        
            elif view == "captcha":
                print("DataDome wants captcha - fingerprint detected as bot")
            else:
                print(f"Unknown view: {view}")
        except json.JSONDecodeError:
            print("Response is not JSON")
    else:
        print(f"POST failed with status {resp3.status_code}")


if __name__ == "__main__":
    main()
