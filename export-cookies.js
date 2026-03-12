// ===== HOW TO EXPORT YOUTUBE COOKIES (includes HttpOnly cookies) =====
//
// The document.cookie method CANNOT access HttpOnly cookies, which are
// the most important ones for YouTube auth (__Secure-1PSID, HSID, etc).
//
// Instead, use the Chrome DevTools NETWORK TAB method:
//
// 1. Open Chrome and go to https://www.youtube.com (make sure you're logged in)
// 2. Press F12 to open DevTools
// 3. Go to the "Network" tab
// 4. Reload the page (F5)
// 5. Click the FIRST request in the list (it should be "www.youtube.com" or similar)
// 6. In the right panel, scroll down to "Request Headers"
// 7. Find the "cookie:" header (it's a very long line)
// 8. RIGHT-CLICK the value → "Copy value"
// 9. Paste that into Vercel → Settings → Environment Variables → YT_COOKIES
// 10. Redeploy the project
//
// The cookie value will look like:
//   PREF=f6=40000000; SID=g.a000...; HSID=AeXe...; SSID=AkN...; ...
//
// The server code automatically detects this format and converts it.
// =====================================================================
