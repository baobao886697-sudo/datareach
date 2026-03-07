/**
 * jsdom DataDome Interstitial Solver (DEPRECATED)
 *
 * This script attempts to solve DataDome interstitial challenges using jsdom.
 * It mocks a browser environment and executes the challenge JavaScript.
 *
 * ===========================================================================
 * ==  DEPRECATION NOTICE                                                   ==
 * ===========================================================================
 * 
 * This approach is NO LONGER RELIABLE for bypassing DataDome.
 * 
 * Key Findings (March 2026):
 *   - DataDome's server-side validation now inspects the encrypted fingerprint
 *     signals in the payload.
 *   - The fingerprint generated in a jsdom environment is easily detected as
 *     non-browser, resulting in a "captcha" response regardless of payload size
 *     or other parameters.
 *   - The core issue is the internal fingerprint collection module (obfuscated)
 *     which collects hundreds of signals. Replicating this accurately in jsdom
 *     is not feasible.
 *
 * RECOMMENDED APPROACH: Use an anti-detect browser like Camoufox.
 * See `camoufox_solver.py` for the working solution.
 * 
 * ===========================================================================
 */

const { JSDOM } = require("jsdom");
const { webcrypto } = require("crypto");
const fs = require("fs");

// ... (rest of the old jsdom code remains for historical reference)

const html_path = process.argv[2];
const interstitial_url = process.argv[3];

if (!html_path || !interstitial_url) {
    console.error("Usage: node jsdom_solver.cjs <path_to_interstitial.html> <interstitial_url>");
    process.exit(1);
}

const interstitial_html = fs.readFileSync(html_path, "utf8");

const dom = new JSDOM(interstitial_html, {
    url: interstitial_url,
    referrer: "https://www.truepeoplesearch.com/",
    contentType: "text/html",
    includeNodeLocations: true,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    resources: "usable",
});

// Add crypto.subtle for SHA-256 hashing used in fingerprinting
dom.window.crypto.subtle = webcrypto.subtle;

// Mock key browser APIs to reduce fingerprinting surface
// (This is not sufficient to bypass modern DataDome)
dom.window.navigator.getBattery = () => Promise.resolve({ charging: true, level: 1 });
dom.window.navigator.connection = { rtt: 50, downlink: 10, effectiveType: '4g' };
dom.window.matchMedia = () => ({ matches: false, addListener: () => {}, removeListener: () => {} });

// Capture the payload when the XHR is sent
dom.window.XMLHttpRequest.prototype.send = function(body) {
    if (this._url.includes("interstitial")) {
        fs.writeFileSync("/tmp/dd_payload.txt", body);
        // Exit immediately to avoid waiting for timeout
        process.exit(0);
    }
};

// Set a timeout in case the challenge doesn't complete
setTimeout(() => {
    console.error("jsdom timeout - challenge did not complete");
    process.exit(1);
}, 12000);
