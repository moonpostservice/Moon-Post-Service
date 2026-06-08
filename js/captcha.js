// Cloudflare Turnstile CAPTCHA helper for Supabase auth (OTP send paths).
// Shared by the main app (index.html) and the admin panel (admin/index.html).
//
// DESIGN: one VISIBLE, always-rendered "managed" widget that continuously keeps a
// fresh token. We render it as soon as the auth modal opens (initCaptcha), so by
// the time the user submits, a token is already in hand. getCaptchaToken() returns
// the current token and immediately resets the widget to mint the NEXT one (tokens
// are single-use). On expiry/error the token is cleared and the widget refreshes.
//
// Why not execute-on-demand / interaction-only: that hid the challenge. Once
// Cloudflare escalated from a silent pass to an interactive challenge, the invisible
// widget never surfaced it, getCaptchaToken() timed out to null, and Supabase
// rejected the tokenless request ("no captcha_token found"). A visible widget shows
// the challenge plainly and is far more reliable.

// PUBLIC site key — safe to ship. Override via window.TURNSTILE_SITE_KEY before load
// (e.g. Cloudflare's test key '1x00000000000000000000AA', which passes on any host,
// for local testing). Default is the real Moon Post Service key (bound to
// www.moonpostservice.com / moonpostservice.com).
const TURNSTILE_SITE_KEY = window.TURNSTILE_SITE_KEY || '0x4AAAAAADgWKXTtSu60qdJo';

let _captchaWidgetId = null;
let _currentToken = null;
let _waiters = [];

function _resolveWaiters(tok) {
    if (!tok) return;
    const ws = _waiters; _waiters = [];
    ws.forEach((r) => { try { r(tok); } catch (_) {} });
}

// Render the widget once into #turnstileHost. Safe to call repeatedly (no-op after
// the first success). Returns false if Turnstile/host aren't ready yet.
function initCaptcha() {
    if (_captchaWidgetId !== null) return true;
    if (typeof turnstile === 'undefined') return false;
    const host = document.getElementById('turnstileHost');
    if (!host) return false;
    try {
        _captchaWidgetId = turnstile.render(host, {
            sitekey: TURNSTILE_SITE_KEY,
            theme: 'dark',            // fits brass-on-navy
            callback: (tok) => { _currentToken = tok; _resolveWaiters(tok); },
            'expired-callback': () => { _currentToken = null; try { turnstile.reset(_captchaWidgetId); } catch (_) {} },
            'error-callback': () => { _currentToken = null; return true; },
        });
    } catch (e) {
        console.warn('[captcha] render failed:', e);
        return false;
    }
    return _captchaWidgetId !== null;
}

// Returns a fresh, single-use Turnstile token (or null if unavailable). Pass it as
// options.captchaToken. After handing out the current token we reset the widget so a
// new token is minted for the next call.
async function getCaptchaToken({ timeoutMs = 12000 } = {}) {
    if (!initCaptcha()) return null;
    let tok = _currentToken;
    if (!tok) {
        tok = await new Promise((resolve) => {
            let done = false;
            const finish = (v) => { if (!done) { done = true; _waiters = _waiters.filter((w) => w !== finish); resolve(v); } };
            _waiters.push(finish);
            setTimeout(() => finish(_currentToken || null), timeoutMs);
        });
    }
    // Consume: clear and mint a fresh token for the next attempt (single-use).
    _currentToken = null;
    if (_captchaWidgetId !== null) { try { turnstile.reset(_captchaWidgetId); } catch (_) {} }
    return tok || null;
}

function resetCaptcha() {
    _currentToken = null;
    if (_captchaWidgetId !== null && typeof turnstile !== 'undefined') {
        try { turnstile.reset(_captchaWidgetId); } catch (_) {}
    }
}

window.initCaptcha = initCaptcha;
window.getCaptchaToken = getCaptchaToken;
window.resetCaptcha = resetCaptcha;
