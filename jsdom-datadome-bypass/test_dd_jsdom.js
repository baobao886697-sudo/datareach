/**
 * Test: Execute DataDome interstitial challenge in Node.js with jsdom
 * Goal: Solve the challenge without a real browser, get a valid cookie
 */

const { JSDOM } = require('jsdom');
const https = require('https');
const http = require('http');

// The interstitial HTML we captured
const fs = require('fs');
const interstitialHTML = fs.readFileSync('/home/ubuntu/interstitial_response.html', 'utf-8');

// We need to intercept the XMLHttpRequest POST to /interstitial/
// and capture the payload being sent

// ResourceLoader removed - not needed

// Create a mock browser environment
const dom = new JSDOM(interstitialHTML, {
    url: 'https://geo.captcha-delivery.com/interstitial/?initialCid=test&hash=test&cid=test&s=50779&e=test&b=2036849&dm=cd',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    resources: 'usable',
    beforeParse(window) {
        // Mock navigator
        Object.defineProperty(window.navigator, 'userAgent', {
            value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
            configurable: true
        });
        Object.defineProperty(window.navigator, 'platform', {
            value: 'Win32',
            configurable: true
        });
        Object.defineProperty(window.navigator, 'hardwareConcurrency', {
            value: 8,
            configurable: true
        });
        Object.defineProperty(window.navigator, 'deviceMemory', {
            value: 8,
            configurable: true
        });
        Object.defineProperty(window.navigator, 'language', {
            value: 'en-US',
            configurable: true
        });
        Object.defineProperty(window.navigator, 'languages', {
            value: ['en-US', 'en'],
            configurable: true
        });
        Object.defineProperty(window.navigator, 'vendor', {
            value: 'Google Inc.',
            configurable: true
        });
        Object.defineProperty(window.navigator, 'maxTouchPoints', {
            value: 0,
            configurable: true
        });
        
        // Mock screen
        Object.defineProperty(window, 'screen', {
            value: {
                width: 1920, height: 1080,
                availWidth: 1920, availHeight: 1040,
                colorDepth: 24, pixelDepth: 24,
                orientation: { type: 'landscape-primary', angle: 0 }
            },
            configurable: true
        });
        
        // Mock performance
        window.performance = window.performance || {};
        window.performance.now = () => Date.now();
        
        // Mock canvas
        const mockCanvas = {
            getContext: function(type) {
                if (type === '2d') {
                    return {
                        fillRect: () => {},
                        fillText: () => {},
                        measureText: () => ({ width: 10 }),
                        getImageData: () => ({ data: new Uint8Array(100) }),
                        canvas: { toDataURL: () => 'data:image/png;base64,mock' },
                        font: '',
                        fillStyle: '',
                        textBaseline: '',
                    };
                }
                if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
                    return {
                        getParameter: (param) => {
                            if (param === 37445) return 'Google Inc. (NVIDIA)';
                            if (param === 37446) return 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0)';
                            return null;
                        },
                        getExtension: (name) => {
                            if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
                            return null;
                        },
                        getSupportedExtensions: () => ['WEBGL_debug_renderer_info'],
                        createBuffer: () => ({}),
                        bindBuffer: () => {},
                        bufferData: () => {},
                        createProgram: () => ({}),
                        createShader: () => ({}),
                        shaderSource: () => {},
                        compileShader: () => {},
                        attachShader: () => {},
                        linkProgram: () => {},
                        useProgram: () => {},
                        drawArrays: () => {},
                        canvas: { toDataURL: () => 'data:image/png;base64,mockwebgl' },
                    };
                }
                return null;
            },
            toDataURL: () => 'data:image/png;base64,mock',
        };
        
        const origCreateElement = window.document.createElement.bind(window.document);
        window.document.createElement = function(tag) {
            const el = origCreateElement(tag);
            if (tag.toLowerCase() === 'canvas') {
                el.getContext = mockCanvas.getContext;
                el.toDataURL = mockCanvas.toDataURL;
            }
            return el;
        };
        
        // Mock AudioContext
        window.AudioContext = window.AudioContext || function() {
            return {
                createOscillator: () => ({ connect: () => {}, start: () => {}, type: '' }),
                createDynamicsCompressor: () => ({ connect: () => {}, threshold: {}, knee: {}, ratio: {}, attack: {}, release: {} }),
                createAnalyser: () => ({ connect: () => {}, fftSize: 0, getFloatFrequencyData: () => {} }),
                destination: {},
                sampleRate: 44100,
                close: () => {},
            };
        };
        window.webkitAudioContext = window.AudioContext;
        
        // Mock WebAssembly
        window.WebAssembly = {
            instantiate: () => Promise.resolve({ instance: { exports: {} } }),
            compile: () => Promise.resolve({}),
        };
        
        // Intercept XMLHttpRequest
        const OrigXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
            const xhr = new OrigXHR();
            const origOpen = xhr.open.bind(xhr);
            const origSend = xhr.send.bind(xhr);
            
            xhr.open = function(method, url, async) {
                console.log(`\n[XHR] ${method} ${url}`);
                this._url = url;
                this._method = method;
                return origOpen(method, url, async);
            };
            
            xhr.send = function(body) {
                console.log(`[XHR] Sending body (${body ? body.length : 0} bytes):`);
                if (body) {
                    console.log(body.substring(0, 500));
                    console.log('...');
                    // Save the full payload
                    fs.writeFileSync('/home/ubuntu/dd_payload.txt', body);
                    console.log('[XHR] Full payload saved to /home/ubuntu/dd_payload.txt');
                }
                return origSend(body);
            };
            
            return xhr;
        };
        
        // Mock parent for postMessage
        window.parent = {
            postMessage: function(data, origin) {
                console.log(`\n[postMessage] Origin: ${origin}`);
                console.log(`[postMessage] Data: ${data}`);
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.cookie) {
                        console.log(`\n🎉 GOT COOKIE: ${parsed.cookie.substring(0, 80)}...`);
                        fs.writeFileSync('/home/ubuntu/dd_cookie_result.txt', parsed.cookie);
                    }
                } catch(e) {}
            },
            location: { href: 'https://www.truepeoplesearch.com/' }
        };
    }
});

// Wait for the challenge to complete
console.log('Challenge started, waiting for completion...');

setTimeout(() => {
    console.log('\n--- Timeout reached (10s) ---');
    console.log('Window errors:', dom.window._ddem || 'none');
    console.log('DD status:', dom.window._ddst || 'unknown');
    
    // Check if payload was captured
    if (fs.existsSync('/home/ubuntu/dd_payload.txt')) {
        console.log('\nPayload was captured!');
    } else {
        console.log('\nNo payload captured - challenge may have failed');
    }
    
    dom.window.close();
    process.exit(0);
}, 10000);
