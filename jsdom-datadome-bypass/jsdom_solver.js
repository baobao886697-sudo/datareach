/**
 * jsdom DataDome Interstitial Solver
 * 
 * Usage: node jsdom_solver.js <html_path> <interstitial_url> <target_url>
 * 
 * Outputs:
 *   - /tmp/dd_payload.txt: The captured POST payload
 *   - stdout: PAYLOAD_CAPTURED:<length> on success
 */
const { JSDOM } = require('/home/ubuntu/node_modules/jsdom');
const { createCanvas } = require('/home/ubuntu/node_modules/@napi-rs/canvas');
const fs = require('fs');

const htmlPath = process.argv[2];
const interstitialUrl = process.argv[3];
const targetUrl = process.argv[4];

if (!htmlPath || !interstitialUrl || !targetUrl) {
    console.error('Usage: node jsdom_solver.js <html_path> <interstitial_url> <target_url>');
    process.exit(1);
}

const html = fs.readFileSync(htmlPath, 'utf-8');

const dom = new JSDOM(html, {
    url: interstitialUrl,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
        // ============================================================
        // Navigator properties
        // ============================================================
        const navProps = {
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            platform: 'Win32',
            hardwareConcurrency: 8,
            deviceMemory: 8,
            language: 'en-US',
            languages: Object.freeze(['en-US', 'en']),
            vendor: 'Google Inc.',
            maxTouchPoints: 0,
            cookieEnabled: true,
            doNotTrack: null,
            appCodeName: 'Mozilla',
            appName: 'Netscape',
            appVersion: '5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            product: 'Gecko',
            productSub: '20030107',
            vendorSub: '',
            webdriver: false,
        };
        for (const [k, v] of Object.entries(navProps)) {
            try { Object.defineProperty(window.navigator, k, { value: v, configurable: true, enumerable: true }); } catch(e) {}
        }

        // Plugins
        const pluginData = [
            { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
        ];
        const pluginList = { length: pluginData.length, item: (i) => pluginData[i] || null, namedItem: (n) => pluginData.find(p => p.name === n) || null, refresh: () => {} };
        for (let i = 0; i < pluginData.length; i++) pluginList[i] = pluginData[i];
        try { Object.defineProperty(window.navigator, 'plugins', { value: pluginList, configurable: true }); } catch(e) {}
        try { Object.defineProperty(window.navigator, 'mimeTypes', { value: { length: 2, item: () => null, namedItem: () => null, 0: { type: 'application/pdf', suffixes: 'pdf', description: '' }, 1: { type: 'text/pdf', suffixes: 'pdf', description: '' } }, configurable: true }); } catch(e) {}
        try { Object.defineProperty(window.navigator, 'connection', { value: { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }, configurable: true }); } catch(e) {}
        window.navigator.getBattery = () => Promise.resolve({ charging: true, chargingTime: 0, dischargingTime: Infinity, level: 1, addEventListener: () => {} });
        window.navigator.permissions = { query: () => Promise.resolve({ state: 'prompt', onchange: null }) };

        // ============================================================
        // Screen & Window dimensions
        // ============================================================
        Object.defineProperty(window, 'screen', {
            value: {
                width: 1920, height: 1080, availWidth: 1920, availHeight: 1040,
                colorDepth: 24, pixelDepth: 24,
                orientation: { type: 'landscape-primary', angle: 0, addEventListener: () => {} }
            }, configurable: true
        });
        const winProps = { innerWidth: 1920, innerHeight: 969, outerWidth: 1920, outerHeight: 1040, devicePixelRatio: 1, screenX: 0, screenY: 0, screenLeft: 0, screenTop: 0 };
        for (const [k, v] of Object.entries(winProps)) {
            Object.defineProperty(window, k, { value: v, configurable: true });
        }

        // ============================================================
        // Performance
        // ============================================================
        const perfStart = Date.now();
        window.performance = window.performance || {};
        window.performance.now = () => Date.now() - perfStart;
        window.performance.timing = { navigationStart: perfStart, loadEventEnd: perfStart + 500, domContentLoadedEventEnd: perfStart + 300 };
        window.performance.getEntriesByType = () => [];
        window.performance.getEntriesByName = () => [];
        window.performance.mark = () => {};
        window.performance.measure = () => {};

        // ============================================================
        // Canvas (real 2D via @napi-rs/canvas, mocked WebGL)
        // ============================================================
        const origCreateElement = window.document.createElement.bind(window.document);
        window.document.createElement = function(tag) {
            const el = origCreateElement(tag);
            if (tag.toLowerCase() === 'canvas') {
                let _w = 300, _h = 150, _realCanvas = null;
                function getRealCanvas() {
                    if (!_realCanvas || _realCanvas.width !== _w || _realCanvas.height !== _h) {
                        _realCanvas = createCanvas(_w, _h);
                    }
                    return _realCanvas;
                }
                Object.defineProperty(el, 'width', { get: () => _w, set: (v) => { _w = v; _realCanvas = null; }, configurable: true });
                Object.defineProperty(el, 'height', { get: () => _h, set: (v) => { _h = v; _realCanvas = null; }, configurable: true });
                el.getContext = function(type) {
                    if (type === '2d') {
                        const realCtx = getRealCanvas().getContext('2d');
                        const handler = {
                            get(target, prop) {
                                if (prop === 'canvas') return el;
                                if (typeof target[prop] === 'function') return function(...args) { return target[prop].apply(target, args); };
                                return target[prop];
                            },
                            set(target, prop, value) { target[prop] = value; return true; }
                        };
                        return new Proxy(realCtx, handler);
                    }
                    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return makeWebGL(el);
                    return null;
                };
                el.toDataURL = function(mime) { return getRealCanvas().toDataURL(mime || 'image/png'); };
                el.toBlob = function(cb, mime) {
                    const dataUrl = getRealCanvas().toDataURL(mime || 'image/png');
                    const b64 = dataUrl.split(',')[1];
                    const buf = Buffer.from(b64, 'base64');
                    cb(new Blob([buf], { type: mime || 'image/png' }));
                };
            }
            return el;
        };

        function makeWebGL(canvas) {
            const params = {
                37445: 'Google Inc. (NVIDIA)',
                37446: 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)',
                7938: 'WebGL 1.0 (OpenGL ES 2.0 Chromium)',
                7936: 'WebKit', 7937: 'WebKit WebGL',
                3379: 16384, 34076: 16384,
                3386: new Int32Array([32767, 32767]),
                36347: 30, 36348: 16, 36349: 16, 35661: 16, 35660: 16, 34024: 16384, 35657: 16, 36345: 4096,
                33901: new Float32Array([1, 1]), 33902: new Float32Array([1, 1024]),
                3408: 8, 3410: 8, 3411: 8, 3412: 8, 3413: 8, 3414: 24,
                35724: 'WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)',
            };
            const extensions = ['ANGLE_instanced_arrays','EXT_blend_minmax','EXT_color_buffer_half_float','EXT_float_blend','EXT_frag_depth','EXT_shader_texture_lod','EXT_texture_filter_anisotropic','EXT_sRGB','OES_element_index_uint','OES_standard_derivatives','OES_texture_float','OES_texture_float_linear','OES_texture_half_float','OES_texture_half_float_linear','OES_vertex_array_object','WEBGL_color_buffer_float','WEBGL_compressed_texture_s3tc','WEBGL_compressed_texture_s3tc_srgb','WEBGL_debug_renderer_info','WEBGL_debug_shaders','WEBGL_depth_texture','WEBGL_draw_buffers','WEBGL_lose_context','WEBGL_multi_draw'];
            return {
                getParameter: (k) => params[k] !== undefined ? params[k] : null,
                getExtension: (n) => {
                    if (n === 'WEBGL_debug_renderer_info') return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
                    if (n === 'EXT_texture_filter_anisotropic') return { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 };
                    if (extensions.includes(n)) return {};
                    return null;
                },
                getSupportedExtensions: () => extensions,
                createBuffer: () => ({}), bindBuffer: () => {}, bufferData: () => {},
                createProgram: () => ({}), createShader: () => ({}),
                shaderSource: () => {}, compileShader: () => {},
                getShaderParameter: () => true, attachShader: () => {},
                linkProgram: () => {}, getProgramParameter: () => true,
                useProgram: () => {}, getAttribLocation: () => 0,
                enableVertexAttribArray: () => {}, vertexAttribPointer: () => {},
                drawArrays: () => {}, drawElements: () => {},
                viewport: () => {}, clearColor: () => {}, clear: () => {},
                enable: () => {}, disable: () => {}, blendFunc: () => {}, depthFunc: () => {},
                createTexture: () => ({}), bindTexture: () => {},
                texImage2D: () => {}, texParameteri: () => {},
                activeTexture: () => {},
                createFramebuffer: () => ({}), bindFramebuffer: () => {},
                framebufferTexture2D: () => {},
                checkFramebufferStatus: () => 36053,
                readPixels: (x, y, w, h, f, t, px) => { if (px) for (let i = 0; i < px.length; i++) px[i] = (i * 17 + 42) & 0xFF; },
                getUniformLocation: () => ({}),
                uniform1f: () => {}, uniform1i: () => {}, uniform2f: () => {},
                uniform3f: () => {}, uniform4f: () => {}, uniformMatrix4fv: () => {},
                deleteShader: () => {}, deleteProgram: () => {},
                deleteBuffer: () => {}, deleteTexture: () => {},
                deleteFramebuffer: () => {}, getError: () => 0,
                pixelStorei: () => {}, generateMipmap: () => {},
                isContextLost: () => false,
                canvas: canvas, drawingBufferWidth: 300, drawingBufferHeight: 150,
            };
        }

        // ============================================================
        // Audio
        // ============================================================
        class MockAudioContext {
            constructor() { this.sampleRate = 44100; this.state = 'running'; this.destination = { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2 }; this.currentTime = 0; }
            createOscillator() { return { type: 'sine', frequency: { value: 440, setValueAtTime: () => {} }, connect: () => {}, start: () => {}, stop: () => {}, disconnect: () => {} }; }
            createDynamicsCompressor() { return { threshold: { value: -24 }, knee: { value: 30 }, ratio: { value: 12 }, attack: { value: 0.003 }, release: { value: 0.25 }, reduction: { value: 0 }, connect: () => {}, disconnect: () => {} }; }
            createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, connect: () => {}, disconnect: () => {} }; }
            createGain() { return { gain: { value: 1, setValueAtTime: () => {} }, connect: () => {}, disconnect: () => {} }; }
            createBiquadFilter() { return { type: 'lowpass', frequency: { value: 350, setValueAtTime: () => {} }, Q: { value: 1 }, gain: { value: 0 }, connect: () => {}, disconnect: () => {} }; }
            createScriptProcessor() { return { connect: () => {}, disconnect: () => {}, onaudioprocess: null, bufferSize: 4096 }; }
            createBufferSource() { return { buffer: null, connect: () => {}, start: () => {}, stop: () => {}, disconnect: () => {} }; }
            createBuffer(c, l, s) { return { numberOfChannels: c, length: l, sampleRate: s, getChannelData: () => new Float32Array(l), duration: l / s }; }
            close() { return Promise.resolve(); }
            resume() { return Promise.resolve(); }
        }
        window.AudioContext = MockAudioContext;
        window.webkitAudioContext = MockAudioContext;
        window.OfflineAudioContext = class extends MockAudioContext {
            constructor(c, l, s) { super(); this.length = l; }
            startRendering() {
                return Promise.resolve({
                    numberOfChannels: 1, length: this.length || 44100, sampleRate: 44100,
                    getChannelData: () => { const d = new Float32Array(this.length || 44100); for (let i = 0; i < d.length; i++) d[i] = Math.sin(i * 0.001) * 0.0001; return d; },
                    duration: (this.length || 44100) / 44100
                });
            }
        };
        window.webkitOfflineAudioContext = window.OfflineAudioContext;

        // ============================================================
        // Misc browser APIs
        // ============================================================
        if (!window.WebAssembly) window.WebAssembly = { instantiate: () => Promise.resolve({ instance: { exports: {} } }), compile: () => Promise.resolve({}), validate: () => true };
        window.Intl.DateTimeFormat = function() { return { resolvedOptions: () => ({ timeZone: 'America/New_York', locale: 'en-US' }), format: (d) => new Date(d).toLocaleDateString('en-US') }; };
        window.requestAnimationFrame = (cb) => setTimeout(cb, 16);
        window.cancelAnimationFrame = (id) => clearTimeout(id);
        window.matchMedia = (q) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false });
        window.speechSynthesis = { getVoices: () => [], speak: () => {}, cancel: () => {}, pending: false, speaking: false, paused: false };
        window.Notification = { permission: 'default' };
        window.chrome = { runtime: {}, loadTimes: () => ({}), csi: () => ({}), app: { isInstalled: false } };

        // ============================================================
        // XHR Intercept - capture the POST payload
        // ============================================================
        const OrigXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            const xhr = new OrigXHR();
            const origOpen = xhr.open.bind(xhr);
            const origSend = xhr.send.bind(xhr);
            const origSetHeader = xhr.setRequestHeader.bind(xhr);
            let _url = '';
            xhr.open = function(method, url, async) { _url = url; return origOpen(method, url, async); };
            xhr.setRequestHeader = function(name, value) { return origSetHeader(name, value); };
            xhr.send = function(body) {
                if (body && _url.includes('interstitial')) {
                    fs.writeFileSync('/tmp/dd_payload.txt', body);
                    console.log('PAYLOAD_CAPTURED:' + body.length);
                }
                return origSend(body);
            };
            return xhr;
        };

        // ============================================================
        // Parent frame mock (for postMessage cookie capture)
        // ============================================================
        window.parent = {
            postMessage: function(data) {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.cookie) {
                        fs.writeFileSync('/tmp/dd_cookie.txt', parsed.cookie);
                        console.log('COOKIE_CAPTURED');
                    }
                } catch(e) {}
            },
            location: { href: targetUrl }
        };
    }
});

// Timeout safety
setTimeout(() => { try { dom.window.close(); } catch(e) {} process.exit(0); }, 12000);
