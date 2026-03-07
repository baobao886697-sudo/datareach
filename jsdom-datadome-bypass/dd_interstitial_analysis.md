# DataDome Interstitial Challenge Analysis

## The Challenge Response (1281 bytes)

The 403 response contains a DataDome "interstitial" challenge (rt='i'):

```javascript
var dd={
  'rt':'i',                    // request type: interstitial (non-captcha)
  'cid':'AHrlqAAAAAMA...',     // client ID
  'hsh':'BA0C85CB01834060078D21FA9FBE55',  // hash
  'b':2036849,                 // unknown parameter
  's':50779,                   // unknown parameter  
  'e':'10d12be3...',           // encrypted data
  'qp':'',                     // query params
  'host':'geo.captcha-delivery.com',  // DataDome challenge host
  'cookie':'OitJpcZS...'       // initial cookie value
}
```

Then it loads: `https://ct.captcha-delivery.com/i.js`

## The Flow:
1. TPS returns 403 with DataDome interstitial challenge
2. The `i.js` script executes in the browser
3. It collects fingerprint data and solves a proof-of-work
4. It sends the result to `geo.captcha-delivery.com`
5. DataDome returns a valid cookie
6. Browser retries the original request with the valid cookie

## Key: We need to fetch and analyze `i.js`
The `i.js` script is the interstitial solver. If we can understand what it does,
we can replicate it in Python.

## The cookie from set-cookie header is NOT valid
Retrying with the cookie from the 403 response still gets 403.
This confirms the cookie needs to be "upgraded" by solving the interstitial.
