// Cloudflare Turnstile CAPTCHA helper for Supabase auth (OTP send paths).
// Shared by the main app (index.html) and the admin panel (admin/index.html).
//
// WHY EXECUTE-ON-DEMAND (not an always-visible inline widget):
// The signup flow is "verify last" — the OTP is only sent at the FINAL step,
// minutes after the email is entered (name → city come in between). A token
// grabbed up front would expire (~5 min) and is single-use, so it would be stale
// by the time signInWithOtp runs. Instead we render ONE Turnstile widget in
// `execution: 'execute'` mode and call turnstile.execute() right before each
// auth call, so every signInWithOtp gets a fresh, single-use token. We reset
// after each use. With `appearance: 'interaction-only'` legitimate users pass
// silently; an interactive challenge only appears when Cloudflare deems it
// necessary — which is exactly what raises the cost of scripted abuse of the
// login flow (the residual check_login_email enumeration vector, F1).

// PUBLIC site key — safe to ship in the frontend. Override per-environment by
// setting `window.TURNSTILE_SITE_KEY` before this script loads.
//
// ⚠️  REPLACE the default before enabling Supabase's "Enable Captcha protection"
//     toggle. The default below is Cloudflare's official "always passes" TEST
//     key so auth keeps working pre-launch. Once the real SECRET is set in
//     Supabase, tokens minted by this test key will be REJECTED and break auth —
//     so swap in the real site key first, then flip the Supabase toggle.
const TURNSTILE_SITE_KEY = window.TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

let _captchaWidgetId = null;
let _captchaResolve = null;

// Render the (invisible until needed) widget exactly once. Returns false if the
// Turnstile script hasn't loaded or there's no host element — callers then send a
// null token, which is harmless while Supabase's captcha toggle is OFF and never
// hard-blocks auth on a CDN hiccup.
function _ensureCaptchaWidget() {
    if (_captchaWidgetId !== null) return true;
    if (typeof turnstile === 'undefined') return false;
    const host = document.getElementById('turnstileHost');
    if (!host) return false;
    try {
        _captchaWidgetId = turnstile.render(host, {
            sitekey: TURNSTILE_SITE_KEY,
            theme: 'dark',                 // fits brass-on-navy
            execution: 'execute',          // wait for turnstile.execute()
            appearance: 'interaction-only',// invisible unless a challenge is required
            callback: (token) => { if (_captchaResolve) _captchaResolve(token); },
            'error-callback': () => { if (_captchaResolve) _captchaResolve(null); return true; },
            'expired-callback': () => { try { turnstile.reset(_captchaWidgetId); } catch (_) {} },
        });
    } catch (e) {
        console.warn('[captcha] render failed:', e);
        return false;
    }
    return _captchaWidgetId !== null;
}

// Returns a fresh, single-use Turnstile token, or null if Turnstile is
// unavailable. Pass the result as `options.captchaToken` on a Supabase auth call.
async function getCaptchaToken() {
    if (!_ensureCaptchaWidget()) return null;
    // Reset first so every attempt starts from a clean slate (tokens are single-use).
    try { turnstile.reset(_captchaWidgetId); } catch (_) {}
    return await new Promise((resolve) => {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; _captchaResolve = null; resolve(v); } };
        _captchaResolve = done;
        try { turnstile.execute(_captchaWidgetId); } catch (_) { done(null); }
        // Safety net: never leave the auth button hanging if the challenge stalls.
        setTimeout(() => done(null), 30000);
    });
}

// Explicitly clear the widget (e.g. after a failed attempt). getCaptchaToken()
// already resets before each run, so this is only needed for manual UX resets.
function resetCaptcha() {
    if (_captchaWidgetId !== null && typeof turnstile !== 'undefined') {
        try { turnstile.reset(_captchaWidgetId); } catch (_) {}
    }
}

window.getCaptchaToken = getCaptchaToken;
window.resetCaptcha = resetCaptcha;
