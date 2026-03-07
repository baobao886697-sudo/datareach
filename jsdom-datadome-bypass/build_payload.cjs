/**
 * Build a custom DataDome interstitial payload using the encryptor library
 * with realistic Chrome browser signals.
 * 
 * Usage: node build_payload.cjs <cid> <hash> [seed]
 * 
 * Outputs the encrypted payload to stdout
 */
const InterstitalEncryptor = require('/home/ubuntu/node_modules/datadome-interstital-encryptor');

const cid = process.argv[2];
const hash = process.argv[3];
const seed = process.argv[4] || 'default_seed';

if (!cid || !hash) {
    console.error('Usage: node build_payload.cjs <cid> <hash> [seed]');
    process.exit(1);
}

const enc = new InterstitalEncryptor(cid, hash, seed);

// ============================================================
// Realistic Chrome 131 on Windows 10 signals
// These are the signals collected by the DataDome interstitial
// fingerprint collector (module 516)
// ============================================================

// Browser identification
enc.addSignal('jsType', 'ch');
enc.addSignal('cType', 'html');
enc.addSignal('ddk', 'A55FBF4311ED6F1BF9911EB71931D5');
enc.addSignal('ddv', '4.29.0');
enc.addSignal('ddvs', '4.29.0');

// Browser info
enc.addSignal('br', 'Chrome');
enc.addSignal('brv', '131.0.0.0');
enc.addSignal('os', 'Windows');
enc.addSignal('osv', '10');
enc.addSignal('p', 'Win32');

// Language
enc.addSignal('hl', 'en-US');
enc.addSignal('hla', 'en-US,en');

// Window/screen
enc.addSignal('br_h', 969);
enc.addSignal('br_w', 1920);
enc.addSignal('br_oh', 1040);
enc.addSignal('br_ow', 1920);
enc.addSignal('s_w', 1920);
enc.addSignal('s_h', 1080);
enc.addSignal('sa_w', 1920);
enc.addSignal('sa_h', 1040);
enc.addSignal('dp0', true);
enc.addSignal('dpr', 1);

// Navigator
enc.addSignal('ua', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');
enc.addSignal('hc', 8);
enc.addSignal('dm', 8);
enc.addSignal('mtp', 0);
enc.addSignal('ce', 'true');
enc.addSignal('lb', false);
enc.addSignal('plu', 'PDF Viewer,Chrome PDF Viewer,Chromium PDF Viewer,Microsoft Edge PDF Viewer,WebKit built-in PDF');
enc.addSignal('wbd', false);
enc.addSignal('wdif', false);
enc.addSignal('wdifrm', false);
enc.addSignal('npmdd', false);
enc.addSignal('jset', Math.floor(Date.now() / 1000));

// Cookies
enc.addSignal('cokys', 's1');
enc.addSignal('cokysv', 'undefined');

// JavaScript features
enc.addSignal('jsf', false);

// Performance
enc.addSignal('tagpu', 0.03);

// WebGL
enc.addSignal('glvd', 'Google Inc. (NVIDIA)');
enc.addSignal('glrd', 'ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 6GB Direct3D11 vs_5_0 ps_5_0, D3D11)');

// Canvas
enc.addSignal('cfp', '1234567890');
enc.addSignal('cfpv', 'canvas winding:yes~canvas fp:data:image/png;base64,');

// Audio
enc.addSignal('aession', '0.04345678901234567');

// Timezone
enc.addSignal('tz', 'America/New_York');
enc.addSignal('tzp', -300);

// Connection
enc.addSignal('ct', '4g');
enc.addSignal('rtt', 50);
enc.addSignal('dl', 10);

// Notification
enc.addSignal('np', 'default');

// Chrome specific
enc.addSignal('wrc', true);
enc.addSignal('wgs', true);

// Touch
enc.addSignal('tch', false);

// Fonts
enc.addSignal('fts', 'Arial,Arial Black,Comic Sans MS,Courier New,Georgia,Impact,Times New Roman,Trebuchet MS,Verdana');

// Color depth
enc.addSignal('cd', 24);

// Session storage
enc.addSignal('ss', true);
enc.addSignal('ls', true);
enc.addSignal('idb', true);

// Do not track
enc.addSignal('dnt', 'unspecified');

// Webdriver
enc.addSignal('wd', false);

// Additional signals for interstitial
enc.addSignal('tagpu', 0.03);
enc.addSignal('wasm', true);

const payload = enc.getPayload();
console.log(payload);
