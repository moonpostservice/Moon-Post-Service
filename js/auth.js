// Supabase Auth, Onboarding & Initialization

// SUPABASE AUTH
// ============================================
const SUPABASE_URL = 'https://znfqqehthxcrizcixzpu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZnFxZWh0aHhjcml6Y2l4enB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0MzMyMDgsImV4cCI6MjA4NjAwOTIwOH0.Twf3d9QEhVq6j9yVKaS9QNhnvygYgxPj0zg6Ug5pAq0';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentAuthUser = null;
let _isInitializing = false; // Guard: prevents concurrent initAuth calls
let _appDataLoaded = false;  // Tracks whether initAuth has successfully loaded data
let _domReady = false;       // Tracks whether DOMContentLoaded has fired
// 'login' = existing-user gate (email must already exist, no account creation).
// 'signup' = genuine new-user flow (OTP may create the auth user). The landing
// hero's "Send" sets this to 'signup' before opening the auth modal.
let authMode = 'login';

// ---- "Verify last" signup ----
// For a genuine new signup we collect email → name → city entirely client-side and
// only send/verify the OTP as the FINAL step. Nothing is created until the code is
// verified, so an incomplete account is impossible. _signupDraft holds the in-progress
// fields; on successful verify it becomes _pendingSignupProfile, which initAuth uses to
// write the complete profile in one shot (no location/profile steps).
let _signupDraft = null;          // { email, name, city:{name,lat,lon,tz} }
let _pendingSignupProfile = null; // set on verify success, consumed by initAuth

// Auth modal show/close
function showAuthModal(mode) {
    authMode = mode === 'signup' ? 'signup' : 'login';
    const isSignup = authMode === 'signup';
    // Fresh start: drop any in-progress signup draft and clear stale field/error state.
    _signupDraft = null;
    ['authEmail', 'authFirstName', 'authLastName'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    const authErr = document.getElementById('authError');
    if (authErr) { authErr.textContent = ''; authErr.style.display = 'none'; }

    // Signup shows its own "Who's this from?" heading + name fields and hides the global
    // brand title; login keeps the title and asks for email only.
    const intro = document.getElementById('signupIntroHead');
    const nameFields = document.getElementById('signupNameFields');
    if (intro) intro.style.display = isSignup ? 'block' : 'none';
    if (nameFields) nameFields.style.display = isSignup ? 'block' : 'none';
    const title = document.getElementById('authModalTitle');
    if (title) { title.textContent = isSignup ? '' : 'Welcome back'; title.style.display = isSignup ? 'none' : ''; }
    const tagline = document.getElementById('authModalTagline');
    if (tagline) tagline.style.display = isSignup ? 'none' : '';
    const emailLabel = document.getElementById('authEmailLabel');
    if (emailLabel) emailLabel.textContent = isSignup ? 'Your email' : 'Enter your email';

    const overlay = document.getElementById('authModalOverlay');
    overlay.style.display = 'flex';
    // Reset to step 1
    document.querySelectorAll('.auth-step').forEach(s => s.classList.remove('active'));
    document.getElementById('authStepEmail')?.classList.add('active');
    // Always reopen with a clean, clickable submit button — a prior send that hung or
    // errored could otherwise leave it stuck on a disabled "Sending..." across reopen.
    resetSendBtn();
    // Start rendering the Turnstile widget now (retrying until the async API script is
    // loaded) so the managed challenge resolves in the background while the user types,
    // not during their submit wait.
    if (typeof warmCaptcha === 'function') warmCaptcha();
    else if (typeof initCaptcha === 'function') initCaptcha();
    setTimeout(() => document.getElementById(isSignup ? 'authFirstName' : 'authEmail')?.focus(), 100);
}
function closeAuthModal() {
    const overlay = document.getElementById('authModalOverlay');
    if (overlay) overlay.style.display = 'none';
    // Hard-reset the modal's internal state so it can NEVER reappear showing a stale
    // screen. The modal is a child of #onboardingOverlay and is hidden after login only
    // as a side effect of the parent being hidden — its own display + active step + typed
    // code all linger. If the onboarding overlay is later re-shown (e.g. on sign-out),
    // that leftover "Enter your Moon Code" screen would pop back up. Resetting on close
    // means a reopen always starts clean at the email step.
    document.querySelectorAll('#authModalOverlay .auth-step').forEach(s => s.classList.remove('active'));
    document.getElementById('authStepEmail')?.classList.add('active');
    for (let i = 1; i <= 6; i++) {
        const d = document.getElementById('otpDigit' + i);
        if (d) d.value = '';
    }
    const authErr = document.getElementById('authError');
    if (authErr) { authErr.textContent = ''; authErr.style.display = 'none'; }
    const otpErr = document.getElementById('otpError');
    if (otpErr) { otpErr.textContent = ''; otpErr.style.display = 'none'; }
}

// Send OTP code to email
let pendingAuthEmail = '';

// The enabled label for the email-step submit button. Centralized so the button can
// always be restored to a clean, clickable state (see resetSendBtn).
const SEND_BTN_HTML = 'Continue <svg class="app-icon md" style="color:#FDF6E3"><use href="#icon-moonkey"/></svg>';
function resetSendBtn() {
    const btn = document.getElementById('authSendBtn');
    if (btn) { btn.innerHTML = SEND_BTN_HTML; btn.disabled = false; }
}

// Race a promise against a timeout so a hung auth/network request can never leave the
// "Sending..." button permanently disabled with no feedback. Resolves to a sentinel
// { __timedOut: true } if the underlying promise doesn't settle in time.
function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve({ __timedOut: true }), ms)),
    ]);
}

// Send an OTP with a Turnstile token, transparently retrying ONCE with a freshly
// minted token if Cloudflare rejects it. Prod auth logs showed intermittent
// 'captcha_failed' on the same domain/keys as successful sends — the symptom of a
// token that went stale/expired between when the widget minted it and when the user
// hit Send (lingering, slow typing, or a backgrounded tab throttling the widget's
// auto-refresh). A fresh token on retry succeeds, so the user never sees the error.
// Returns a normalized shape: { noToken } | { timedOut } | { threw, error } |
// the raw Supabase result ({ error } or {}).
async function sendOtpWithCaptcha(email, shouldCreateUser) {
    const attempt = async (token) => {
        try {
            const r = await withTimeout(sb.auth.signInWithOtp({
                email, options: { shouldCreateUser, captchaToken: token }
            }), 15000);
            if (r && r.__timedOut) return { timedOut: true };
            return r || {};
        } catch (e) {
            console.warn('[auth] signInWithOtp threw:', e);
            return { threw: true, error: e };
        }
    };
    let token = await getCaptchaToken();
    if (!token) return { noToken: true };
    let res = await attempt(token);
    // Only retry a genuine captcha rejection (not a network throw/timeout).
    if (res.error && !res.threw && !res.timedOut && /captcha/i.test(res.error.message || '')) {
        if (typeof resetCaptcha === 'function') resetCaptcha();
        const fresh = await getCaptchaToken();
        if (fresh) res = await attempt(fresh);
    }
    return res;
}

async function sendMoonKey() {
    const email = document.getElementById('authEmail').value.trim();
    const errorEl = document.getElementById('authError');
    const btn = document.getElementById('authSendBtn');

    // Signup collects the sender's name on this same step — require a first name.
    if (authMode === 'signup' && !(document.getElementById('authFirstName')?.value || '').trim()) {
        errorEl.textContent = 'Add your first name so the moon knows who is writing.';
        errorEl.style.display = 'block';
        document.getElementById('authFirstName')?.focus();
        return;
    }

    if (!email || !email.includes('@')) {
        errorEl.textContent = 'Please enter a valid email address.';
        errorEl.style.display = 'block';
        return;
    }

    errorEl.style.display = 'none';
    btn.textContent = 'Sending...';
    btn.disabled = true;

    // NO EXISTENCE PRE-CHECK (F1). We deliberately do NOT probe whether the email is
    // registered. The old check_login_email RPC was an anon-callable enumeration
    // oracle (a row meant "registered", empty meant "not"), and the captcha only
    // guarded the browser path — a script could call the RPC directly. The RPC is
    // now dropped, and existence is never revealed in the UI either (see below).

    // VERIFY-LAST signup: collect name + city BEFORE sending any code or touching the
    // auth system. Since we can no longer tell whether the email already exists, EVERY
    // signup runs the verify-last flow. If the email turns out to belong to an existing
    // account, initAuth finds the profile on verify and just logs them in — the
    // collected draft is ignored — so a returning user is never harmed by these steps.
    if (authMode === 'signup') {
        _signupDraft = {
            email,
            firstName: (document.getElementById('authFirstName')?.value || '').trim(),
            lastName: (document.getElementById('authLastName')?.value || '').trim(),
            city: null
        };
        pendingAuthEmail = email;
        btn.innerHTML = 'Continue <svg class="app-icon md" style="color:#FDF6E3"><use href="#icon-moonkey"/></svg>';
        btn.disabled = false;
        showLocationStep();
        return;
    }

    // LOGIN: never reveal whether the email is registered. With shouldCreateUser:false
    // Supabase sends a code only if a confirmed account exists, and we advance to the
    // neutral "if an account exists, we've sent a code" screen REGARDLESS of the
    // outcome — so a non-existent email is indistinguishable from a real one and there
    // is no enumeration oracle. Only clearly-recoverable, non-leaky errors (rate limit,
    // captcha) are surfaced; any existence-revealing error is swallowed.
    // Send the code with a captcha token; transparently retries once on a stale-token
    // captcha rejection (see sendOtpWithCaptcha). Neither a network error nor a timeout
    // reveals account existence, so both are safe to surface — unlike the "email not
    // found" path below, which stays silent to avoid an enumeration oracle.
    const result = await sendOtpWithCaptcha(email, false);
    if (result.noToken) {
        errorEl.textContent = 'Please complete the verification check above and try again.';
        errorEl.style.display = 'block';
        resetSendBtn();
        return;
    }
    if (result.threw) {
        errorEl.textContent = "We couldn't reach the server. Please try again.";
        errorEl.style.display = 'block';
        resetSendBtn();
        return;
    }
    if (result.timedOut) {
        errorEl.textContent = 'That took too long. Please try again.';
        errorEl.style.display = 'block';
        resetSendBtn();
        return;
    }
    const { error } = result || {};

    if (error && (error.status === 429 || /captcha/i.test(error.message || ''))) {
        errorEl.textContent = error.status === 429
            ? 'Too many attempts. Please wait a moment and try again.'
            : 'Verification failed. Please try again.';
        errorEl.style.display = 'block';
        resetSendBtn();
        return;
    }
    // Any other error (e.g. "email not found" / "signups not allowed") is intentionally
    // NOT surfaced — falling through to the neutral code screen keeps existence private.

    pendingAuthEmail = email;
    // Neutral, existence-agnostic copy for the login path + a path to signup for
    // anyone who isn't actually registered (they can't tell, and that's the point).
    const codeIntro = document.getElementById('authCodeIntro');
    if (codeIntro) codeIntro.textContent = "If an account exists, we've sent a 6-digit code to";
    const signupHint = document.getElementById('authCodeSignupHint');
    if (signupHint) signupHint.style.display = 'block';
    document.getElementById('authEmailSent').textContent = email;
    document.getElementById('authStepEmail').classList.remove('active');
    document.getElementById('authStepCode').classList.add('active');
    setupOtpInputs();
    document.getElementById('otpDigit1').focus();
}

// ---- VERIFY-LAST signup steps: (name+email collected on step 1) → city → code last ----

// Final step for verify-last signup: NOW send the OTP and show the code entry. This is the
// first moment any account row can come into existence — only for a committed user who has
// already given name + city.
async function enterVerifyStep() {
    if (!_signupDraft) return;
    document.querySelectorAll('.auth-step').forEach(s => s.classList.remove('active'));
    document.getElementById('authStepCode').classList.add('active');
    document.getElementById('authEmailSent').textContent = _signupDraft.email;
    // Signup definitely sent a code (we're creating the account) — keep the definite
    // wording and hide the login-only "sign up" hint.
    const codeIntro = document.getElementById('authCodeIntro');
    if (codeIntro) codeIntro.textContent = 'We sent a 6-digit code to';
    const signupHint = document.getElementById('authCodeSignupHint');
    if (signupHint) signupHint.style.display = 'none';
    const otpError = document.getElementById('otpError');
    if (otpError) otpError.style.display = 'none';

    // This fires at the END of the signup flow (after name + city), minutes after the
    // email step, so any earlier token would have expired — sendOtpWithCaptcha mints a
    // fresh one and transparently retries once if it's rejected as stale.
    const result = await sendOtpWithCaptcha(_signupDraft.email, true);
    if (result.noToken) {
        if (otpError) { otpError.textContent = 'Please complete the verification check above and try again.'; otpError.style.display = 'block'; }
        return;
    }
    if (result.threw) {
        if (otpError) { otpError.textContent = "We couldn't reach the server. Please tap Resend code."; otpError.style.display = 'block'; }
        return;
    }
    if (result.timedOut) {
        if (otpError) { otpError.textContent = 'That took too long. Please tap Resend code.'; otpError.style.display = 'block'; }
        return;
    }
    const { error } = result || {};
    if (error) {
        if (otpError) { otpError.textContent = error.message || 'Could not send your code. Try again.'; otpError.style.display = 'block'; }
        return;
    }
    pendingAuthEmail = _signupDraft.email;
    setupOtpInputs();
    document.getElementById('otpDigit1')?.focus();
}

function setupOtpInputs() {
    for (let i = 1; i <= 6; i++) {
        const input = document.getElementById('otpDigit' + i);
        input.value = '';
        // Clone the node to strip any previously attached listeners before re-adding
        const fresh = input.cloneNode(true);
        input.parentNode.replaceChild(fresh, input);
        fresh.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, '');
            e.target.value = val;
            if (val && i < 6) document.getElementById('otpDigit' + (i + 1)).focus();
            checkOtpComplete();
        });
        fresh.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && i > 1) {
                document.getElementById('otpDigit' + (i - 1)).focus();
            }
            if (e.key === 'Enter') verifyMoonKey();
        });
        fresh.addEventListener('paste', (e) => {
            e.preventDefault();
            const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '').slice(0, 6);
            for (let j = 0; j < paste.length; j++) {
                const d = document.getElementById('otpDigit' + (j + 1));
                if (d) d.value = paste[j];
            }
            checkOtpComplete();
            if (paste.length === 6) verifyMoonKey();
        });
    }
}

function checkOtpComplete() {
    let code = '';
    for (let i = 1; i <= 6; i++) code += document.getElementById('otpDigit' + i).value;
    document.getElementById('verifyCodeBtn').disabled = code.length < 6;
}

async function verifyMoonKey() {
    let code = '';
    for (let i = 1; i <= 6; i++) code += document.getElementById('otpDigit' + i).value;
    if (code.length < 6) return;

    const btn = document.getElementById('verifyCodeBtn');
    const errorEl = document.getElementById('otpError');
    btn.textContent = 'Verifying...';
    btn.disabled = true;
    errorEl.style.display = 'none';

    const { error } = await sb.auth.verifyOtp({
        email: pendingAuthEmail,
        token: code,
        type: 'email'
    });

    if (error) {
        errorEl.textContent = error.message || 'Invalid code. Please try again.';
        errorEl.style.display = 'block';
        btn.textContent = 'Welcome!';
        btn.disabled = false;
        // Clear OTP inputs
        for (let i = 1; i <= 6; i++) document.getElementById('otpDigit' + i).value = '';
        document.getElementById('otpDigit1').focus();
        return;
    }

    // Auth successful. For a verify-last signup, promote the collected draft so initAuth
    // writes the COMPLETE profile in one shot (no further steps). For login, fall through
    // to the existing behaviour.
    if (_signupDraft) {
        _pendingSignupProfile = {
            email: _signupDraft.email,
            firstName: _signupDraft.firstName,
            lastName: _signupDraft.lastName,
            city: _signupDraft.city
        };
        _signupDraft = null;
    }

    btn.textContent = 'Welcome!';
    window._needsLocationCheck = true;
    // Don't close modal — initAuth will write the profile / hide onboarding as appropriate.
}

// ========================
// LOCATION ONBOARDING STEP
// ========================
let _detectedOnboardingCity = null;

function showLocationStep() {
    // Hide other auth steps, show location step
    document.querySelectorAll('.auth-step').forEach(s => s.classList.remove('active'));
    document.getElementById('authStepLocation').classList.add('active');

    // Show the onboarding overlay if not visible
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay.classList.contains('hidden')) overlay.classList.remove('hidden');

    // Also show the auth modal (location step is inside it)
    const authModal = document.getElementById('authModalOverlay');
    if (authModal) authModal.style.display = 'flex';

    // Auto-detect city from browser timezone
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const detected = cities.find(c => c.tz === browserTz) ||
                     cities.find(c => c.tz && c.tz.split('/')[0] === browserTz.split('/')[0]);

    if (detected) {
        _detectedOnboardingCity = detected;
        document.getElementById('detectedCityName').textContent = detected.name;
        document.getElementById('detectedCityCard').style.display = 'block';
        document.getElementById('confirmLocationBtn').style.display = '';
        document.getElementById('locationDetectStatus').textContent = 'We detected your location from your timezone';
        document.getElementById('showManualCityLink').style.display = '';
    } else {
        // Can't detect — go straight to manual picker
        document.getElementById('locationDetectStatus').textContent = 'Tell us where you are';
        document.getElementById('detectedCityCard').style.display = 'none';
        document.getElementById('confirmLocationBtn').style.display = 'none';
        document.getElementById('manualCityPicker').style.display = 'block';
        document.getElementById('showManualCityLink').style.display = 'none';
    }
}

async function confirmDetectedLocation() {
    if (!_detectedOnboardingCity) return;
    await saveOnboardingCity(_detectedOnboardingCity);
}

// ---- TIMEZONE DRIFT DETECTION ----
let _driftNewCity = null;

function checkLocationDrift(profileCity) {
    // Don't nag if dismissed within last 24h
    const dismissed = localStorage.getItem('moonpop_drift_dismissed');
    if (dismissed) {
        const dismissedAt = new Date(dismissed);
        if (Date.now() - dismissedAt.getTime() < 24 * 3600000) return;
    }

    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserTz || !profileCity) return;

    // Find the profile city's timezone
    const currentCity = cities.find(c => c.name === profileCity);
    if (!currentCity || !currentCity.tz) return;

    // Compare timezones
    if (browserTz === currentCity.tz) return; // Same timezone — no drift

    // Different timezone detected — find the new city
    const newCity = cities.find(c => c.tz === browserTz) ||
                    cities.find(c => c.tz && c.tz.split('/')[0] === browserTz.split('/')[0]);
    if (!newCity || newCity.name === profileCity) return; // Same city or can't detect

    _driftNewCity = newCity;

    // Populate and show the modal
    document.getElementById('driftNewCity').textContent = newCity.name;
    document.getElementById('driftOldCity').textContent = profileCity;
    document.getElementById('driftTitle').textContent = `It looks like you're in ${newCity.name}`;
    document.getElementById('driftSubtitle').textContent = `Your moon times are based on ${profileCity}`;
    document.getElementById('locationDriftModal').style.display = 'flex';
    console.log('[drift] Timezone changed:', currentCity.tz, '→', browserTz, '| Suggesting:', newCity.name);
}

async function acceptDrift() {
    if (!_driftNewCity) return;
    document.getElementById('locationDriftModal').style.display = 'none';
    localStorage.removeItem('moonpop_drift_dismissed');
    await saveOnboardingCity(_driftNewCity);
    console.log('[drift] Updated location to:', _driftNewCity.name);
    _driftNewCity = null;
}

function dismissDrift() {
    document.getElementById('locationDriftModal').style.display = 'none';
    localStorage.setItem('moonpop_drift_dismissed', new Date().toISOString());
    console.log('[drift] Dismissed for 24h');
    _driftNewCity = null;
}

function showManualLocationPicker() {
    const picker = document.getElementById('driftManualPicker');
    if (picker) {
        picker.style.display = '';
        const input = document.getElementById('driftManualInput');
        if (input) input.focus();
        // Replace node to strip any previously stacked listeners before re-adding
        const freshInput = input.cloneNode(true);
        input.parentNode.replaceChild(freshInput, input);
        freshInput.focus();
        freshInput.addEventListener('input', function() {
            const q = this.value.trim().toLowerCase();
            const dropdown = document.getElementById('driftManualDropdown');
            if (!dropdown) return;
            if (q.length < 2) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }
            const matches = cities.filter(c => c.name.toLowerCase().startsWith(q)).slice(0, 6);
            if (matches.length === 0) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }
            dropdown.style.display = '';
            dropdown.innerHTML = matches.map(c =>
                `<div onclick="selectDriftCity('${c.name}')" style="padding:8px 12px;cursor:pointer;color:var(--blue);font-size:14px;border-bottom:1px solid rgba(212,181,138,0.1);">${c.name}, ${c.country}</div>`
            ).join('');
        });
    }
}

let _driftManualCity = null;
function selectDriftCity(cityName) {
    const city = cities.find(c => c.name === cityName);
    if (!city) return;
    _driftManualCity = city;
    document.getElementById('driftManualInput').value = `${city.name}, ${city.country}`;
    const dropdown = document.getElementById('driftManualDropdown');
    if (dropdown) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }
}

async function applyManualLocation() {
    if (!_driftManualCity) {
        // Try to match typed text
        const input = document.getElementById('driftManualInput');
        const q = (input?.value || '').trim().toLowerCase();
        const match = cities.find(c => c.name.toLowerCase() === q);
        if (match) _driftManualCity = match;
    }
    if (!_driftManualCity) return;
    document.getElementById('locationDriftModal').style.display = 'none';
    localStorage.removeItem('moonpop_drift_dismissed');
    await saveOnboardingCity(_driftManualCity);
    console.log('[drift] Manual location set to:', _driftManualCity.name);
    _driftManualCity = null;
}

async function selectOnboardingCity(cityName) {
    const city = cities.find(c => c.name === cityName);
    if (!city) return;
    _detectedOnboardingCity = city;
    document.getElementById('onboardingCityInput').value = cityName;
    document.getElementById('onboardingCityDropdown').innerHTML = '';
    document.getElementById('onboardingCityDropdown').style.display = 'none';
    // Update the card to show selected city
    document.getElementById('detectedCityName').textContent = city.name;
    document.getElementById('detectedCityCard').style.display = 'block';
    document.getElementById('confirmLocationBtn').style.display = '';
    document.getElementById('confirmLocationBtn').textContent = "That's my sky 🌙";
    document.getElementById('locationDetectStatus').textContent = '';
    await saveOnboardingCity(city);
}

async function saveOnboardingCity(city) {
    const btn = document.getElementById('confirmLocationBtn');
    if (btn) { btn.textContent = 'Setting your sky...'; btn.disabled = true; }

    // VERIFY LAST: during a new signup we aren't authenticated yet — hold the city in the
    // draft and advance to the final code step. Nothing is written to the DB here; the
    // complete profile is written once the email is verified.
    if (_signupDraft && !currentAuthUser) {
        _signupDraft.city = { name: city.name, lat: city.lat, lon: city.lon, tz: city.tz };
        localStorage.setItem('moonpop_location', JSON.stringify({ name: city.name, country: city.country }));
        if (btn) { btn.textContent = "That's my sky 🌙"; btn.disabled = false; }
        await enterVerifyStep();
        return;
    }

    // Save to localStorage
    localStorage.setItem('moonpop_location', JSON.stringify({ name: city.name, country: city.country }));
    // Save to Supabase profile
    if (currentAuthUser) {
        await sb.from('profiles').update({
            city: city.name,
            latitude: city.lat,
            longitude: city.lon,
            timezone: city.tz
        }).eq('id', currentAuthUser.id);
        console.log('[location] Saved to DB:', city.name);
    }
    // Initialize moon calculations
    updateLocationDisplay(city.name, city.country);
    onLocationObtained(city.lat, city.lon, city.tz);

    // Check if this is a new user (no username set yet) — show profile setup
    if (!currentAuthUser) { console.warn('[saveOnboardingCity] No auth user yet, skipping profile check'); return; }
    // Detect new users by first_name, not username: a freshly-created profile carries a
    // placeholder username (the email prefix) to satisfy the NOT NULL column, so only
    // first_name reliably signals "completed the profile/consent step".
    const { data: checkProfile } = await sb.from('profiles').select('first_name').eq('id', currentAuthUser.id).single();
    if (!checkProfile || !checkProfile.first_name) {
        // New user — show profile step
        showProfileStep();
        return;
    }

    // Existing user — proceed to app
    localStorage.setItem('moonpop_seen', 'true');
    hideOnboarding();
    if (!_appDataLoaded) {
        await initAuth();
    }
}

function showProfileStep() {
    document.querySelectorAll('.auth-step').forEach(s => s.classList.remove('active'));
    document.getElementById('authStepProfile').classList.add('active');
    // Show auth modal if hidden
    const authModal = document.getElementById('authModalOverlay');
    if (authModal) authModal.style.display = 'flex';
    setTimeout(() => document.getElementById('onboardingFirstName')?.focus(), 100);
}

function autoFillSenderName() {
    const first = document.getElementById('onboardingFirstName').value.trim();
    const senderField = document.getElementById('onboardingSenderName');
    if (!senderField._userEdited) {
        senderField.value = first;
    }
    checkOnboardingReady();
}

function checkOnboardingReady() {
    const first = document.getElementById('onboardingFirstName')?.value.trim();
    const last = document.getElementById('onboardingLastName')?.value.trim();
    const sender = document.getElementById('onboardingSenderName')?.value.trim();
    const terms = document.getElementById('onboardingTermsCheck')?.checked;
    const btn = document.getElementById('saveProfileBtn');
    if (btn) btn.disabled = !(first && last && sender && terms);
}

// Track if user manually edited sender name; re-check readiness on every keystroke
document.addEventListener('DOMContentLoaded', () => {
    const sn = document.getElementById('onboardingSenderName');
    if (sn) sn.addEventListener('input', () => { sn._userEdited = true; checkOnboardingReady(); });
    const ln = document.getElementById('onboardingLastName');
    if (ln) ln.addEventListener('input', checkOnboardingReady);
});

let _onboardingAvatarFile = null;
function previewOnboardingAvatar(input) {
    if (!input.files || !input.files[0]) return;
    _onboardingAvatarFile = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
        const preview = document.getElementById('onboardingAvatarPreview');
        preview.innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;">`;
    };
    reader.readAsDataURL(_onboardingAvatarFile);
}

async function saveOnboardingProfile() {
    const firstName = document.getElementById('onboardingFirstName').value.trim();
    const lastName = document.getElementById('onboardingLastName').value.trim();
    const senderName = document.getElementById('onboardingSenderName').value.trim();
    const errorEl = document.getElementById('onboardingProfileError');
    const btn = document.getElementById('saveProfileBtn');

    if (!firstName) {
        errorEl.textContent = 'First name is required';
        errorEl.style.display = 'block';
        document.getElementById('onboardingFirstName').focus();
        return;
    }
    if (!lastName) {
        errorEl.textContent = 'Last name is required';
        errorEl.style.display = 'block';
        document.getElementById('onboardingLastName').focus();
        return;
    }
    if (!senderName) {
        errorEl.textContent = 'Sender name is required — this is what people see on your messages';
        errorEl.style.display = 'block';
        document.getElementById('onboardingSenderName').focus();
        return;
    }

    errorEl.style.display = 'none';
    btn.textContent = 'Setting up...';
    btn.disabled = true;

    try {
        // Save profile
        const { error: profileError } = await sb.from('profiles').update({
            first_name: firstName,
            last_name: lastName,
            username: senderName
        }).eq('id', currentAuthUser.id);

        if (profileError) throw profileError;

        // Upload avatar if selected
        if (_onboardingAvatarFile && currentAuthUser) {
            const filePath = `${currentAuthUser.id}/avatar.jpg`;
            const { error: uploadError } = await sb.storage.from('avatars').upload(filePath, _onboardingAvatarFile, { upsert: true });
            if (!uploadError) {
                const { data: urlData } = sb.storage.from('avatars').getPublicUrl(filePath);
                if (urlData?.publicUrl) {
                    await sb.from('profiles').update({ avatar_url: urlData.publicUrl + '?t=' + Date.now() }).eq('id', currentAuthUser.id);
                }
            }
        }

        // Store locally
        localStorage.setItem('moonpop_username', senderName);

        // Proceed to app
        localStorage.setItem('moonpop_seen', 'true');
        hideOnboarding();
        if (!_appDataLoaded) {
            await initAuth();
        }
    } catch (e) {
        console.error('Profile save failed:', e);
        errorEl.textContent = 'Something went wrong. Please try again.';
        errorEl.style.display = 'block';
        btn.textContent = 'Start sending 🌙';
        btn.disabled = false;
    }
}

function filterOnboardingCities(query) {
    const dropdown = document.getElementById('onboardingCityDropdown');
    if (!query || query.length < 2) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }
    const q = query.toLowerCase();
    const matches = cities.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8);
    if (matches.length === 0) { dropdown.innerHTML = '<div style="padding:8px 12px;color:var(--text-muted);font-size:13px;">No cities found</div>'; dropdown.style.display = 'block'; return; }
    dropdown.innerHTML = matches.map(c =>
        `<div class="city-option" onclick="selectOnboardingCity('${c.name}')" style="padding:8px 12px;cursor:pointer;font-size:14px;color:white;">
            <b>${c.name}</b> <span style="color:var(--text-muted);font-size:12px;">${c.country}</span>
        </div>`
    ).join('');
    dropdown.style.display = 'block';
}

async function resendMoonKey() {
    const email = pendingAuthEmail || document.getElementById('authEmailSent').textContent;
    // Mirror the original send: a login resend must NOT create a user (false), while a
    // signup resend may (true) — same safety as sendMoonKey. No profile is created until
    // the email is confirmed, so a resend can't produce a phantom account either way.
    // sendOtpWithCaptcha transparently retries once on a stale-token captcha rejection.
    const result = await sendOtpWithCaptcha(email, authMode === 'signup');
    if (result.noToken) {
        alert('Please complete the verification check, then tap Resend again.');
        return;
    }
    if (result.threw) {
        alert("We couldn't reach the server. Please try again in a moment.");
        return;
    }
    if (result.timedOut) {
        alert('That took too long. Please try again in a moment.');
        return;
    }
    const { error } = result || {};
    if (!error) {
        alert('New code sent! Check your inbox.');
    } else {
        alert(error.message || 'Could not resend. Try again in a moment.');
    }
}

function changeEmail() {
    document.getElementById('authStepCode').classList.remove('active');
    document.getElementById('authStepEmail').classList.add('active');
    resetSendBtn();
    document.getElementById('authEmail').focus();
}

// Show profile setup step after auth
function showProfileSetup() {
    const overlay = document.getElementById('onboardingOverlay');
    if (overlay) overlay.classList.remove('hidden');
    const stepEmail = document.getElementById('authStepEmail');
    if (stepEmail) stepEmail.classList.remove('active');
    const stepInbox = document.getElementById('authStepInbox');
    if (stepInbox) stepInbox.classList.remove('active');
    const stepProfile = document.getElementById('authStepProfile');
    if (stepProfile) stepProfile.classList.add('active');
    checkGeolocationSupport();
    autoDetectFromTimezone();
}

// ============================================
// AUTH INITIALIZATION
// ============================================
async function initAuth(sessionOverride) {
    console.log('[initAuth] START', sessionOverride ? 'with session override' : 'no override',
                '_isInitializing=' + _isInitializing, '_appDataLoaded=' + _appDataLoaded);

    // Prevent concurrent initAuth calls (race between onAuthStateChange + DOMContentLoaded)
    if (_isInitializing) {
        console.log('[initAuth] Already initializing, skipping');
        return;
    }
    if (_appDataLoaded) {
        console.log('[initAuth] Data already loaded, skipping');
        return;
    }
    _isInitializing = true;

    try {
    // Check if this is a message reveal link (?m=xxx)
    const isMessageLink = await checkMessageLink();
    if (isMessageLink) return; // Don't load the app, just show the reveal page

    // Legacy: clean up any old magic link tokens in URL
    if (window.location.hash.includes('access_token')) {
        await new Promise(resolve => setTimeout(resolve, 500));
        history.replaceState(null, '', window.location.pathname);
    }

    // Use session from onAuthStateChange if provided, otherwise fetch it
    let session = sessionOverride || null;
    if (!session) {
        console.log('[initAuth] No session override, calling getSession()...');
        const { data, error: sessionError } = await sb.auth.getSession();
        if (sessionError) console.error('[initAuth] getSession error:', sessionError);
        session = data?.session;
        console.log('[initAuth] getSession result:', session ? session.user.email : 'null');
    }

    if (session) {
        currentAuthUser = session.user;
        console.log('[initAuth] Authenticated as', session.user.email, session.user.id);
        let profile = null;
        try {
            const { data: profileData } = await sb
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .single();
            profile = profileData;

            // New user — create profile row
            if (!profile) {
                if (_pendingSignupProfile) {
                    // VERIFY LAST: a completed signup draft means name + city are already in
                    // hand. Write the COMPLETE profile in one shot and continue straight into
                    // the app — no location/profile steps, no incomplete state possible.
                    console.log('[initAuth] New signup — writing complete profile');
                    const d = _pendingSignupProfile;
                    _pendingSignupProfile = null;
                    const c = d.city || {};
                    const fullName = [d.firstName, d.lastName].filter(Boolean).join(' ').trim()
                        || (session.user.email || 'moonfriend').split('@')[0];
                    const completeProfile = {
                        id: session.user.id,
                        email: session.user.email,
                        username: fullName,
                        first_name: d.firstName || fullName,
                        last_name: d.lastName || null,
                        city: c.name || null,
                        latitude: (c.lat != null ? c.lat : null),
                        longitude: (c.lon != null ? c.lon : null),
                        timezone: c.tz || null
                    };
                    const { data: createdProfile, error: createErr } = await sb.from('profiles').insert(completeProfile).select().single();
                    if (createErr) {
                        console.error('[initAuth] Complete profile creation failed:', createErr);
                        await sb.from('profiles').upsert(completeProfile);
                    }
                    localStorage.setItem('moonpop_username', fullName);
                    localStorage.setItem('moonpop_seen', 'true');
                    profile = createdProfile || completeProfile;
                    // fall through to the if (profile) block below — do NOT return
                } else {
                    console.log('[initAuth] New user — creating profile');
                    // username is NOT NULL with no default. The AFTER-INSERT trigger that used
                    // to fill it (and created phantom profiles for unconfirmed emails) was
                    // removed, so we seed a placeholder here; the onboarding steps overwrite
                    // it with the real name. (Legacy fallback for any auth user without a
                    // verify-last draft — e.g. an admin-created account.)
                    const _placeholderUsername = (session.user.email || 'moonfriend').split('@')[0];
                    const { data: newProfile, error: insertErr } = await sb.from('profiles').insert({
                        id: session.user.id,
                        email: session.user.email,
                        username: _placeholderUsername
                    }).select().single();
                    if (insertErr) {
                        console.error('[initAuth] Profile creation failed:', insertErr);
                        // Try upsert as fallback
                        await sb.from('profiles').upsert({ id: session.user.id, email: session.user.email, username: _placeholderUsername });
                    }
                    // Show location step for new user
                    showLocationStep();
                    _isInitializing = false;
                    return;
                }
            }

            if (profile) {
                // Ensure email is saved to profile (for contact lookup)
                if (!profile.email && session.user.email) {
                    await sb.from('profiles').update({ email: session.user.email }).eq('id', session.user.id);
                }

                // Load saved profile data
                if (profile.username) {
                    document.getElementById('userInitials').textContent = profile.username.charAt(0).toUpperCase();
                    const userNameField = document.getElementById('userName');
                    if (userNameField) userNameField.value = profile.username;
                    localStorage.setItem('moonpop_username', profile.username);
                }
                if (profile.first_name) {
                    const fn = document.getElementById('settingsFirstName');
                    if (fn) fn.value = profile.first_name;
                }
                if (profile.last_name) {
                    const ln = document.getElementById('settingsLastName');
                    if (ln) ln.value = profile.last_name;
                }
                captureProfileOriginal();
                // Load notification preferences
                _notifyEmail = profile.notify_email !== false; // default true
                _notifyPush = profile.notify_push !== false;
                _rouletteOptIn = profile.receive_moon_roulette !== false; // default true
                updateEmailNotifBtn();
                updateRouletteOptInBtn();

                if (profile.city) {
                    const city = cities.find(c => c.name === profile.city);
                    if (city) {
                        updateLocationDisplay(city.name, city.country);
                        onLocationObtained(city.lat, city.lon, city.tz);
                        localStorage.setItem('moonpop_location', JSON.stringify({ name: city.name, country: city.country }));
                    }
                } else {
                    // No city saved — show mandatory location step
                    console.log('[initAuth] No city — showing location step');
                    showLocationStep();
                    return; // Don't proceed to app until location is set
                }
            }
        } catch (e) {
            console.error('Profile check failed:', e);
            showLocationStep();
            return;
        }

        // City is set — check for timezone drift (user may have traveled)
        checkLocationDrift(profile.city);

        // Go straight to the app
        localStorage.setItem('moonpop_seen', 'true');
        hideOnboarding();
        // Fully close + reset the auth modal on login success. Hiding only the parent
        // onboarding overlay leaves the modal at display:flex with the OTP step still
        // active — which is what resurfaced as a stale "Enter your Moon Code" screen when
        // the overlay was later re-shown on sign-out.
        closeAuthModal();

        // Ensure userInitials always has a fallback letter
        const initialsEl = document.getElementById('userInitials');
        if (initialsEl && !initialsEl.textContent.trim()) {
            const fallbackName = profile?.username || profile?.first_name || session.user.email || '?';
            initialsEl.textContent = fallbackName.charAt(0).toUpperCase();
        }

        // Avatar sync: localStorage ↔ Supabase profiles
        // IMPORTANT: localStorage is shared across users on same browser.
        // Only trust local avatar if it was saved by THIS user.
        const localAvatar = localStorage.getItem('moonpop_profilepic');
        const localAvatarOwner = localStorage.getItem('moonpop_profilepic_owner');
        const isOwnAvatar = localAvatarOwner === currentAuthUser.id;

        if (profile && profile.avatar_url) {
            // Profile has an avatar — always use it as source of truth
            localStorage.setItem('moonpop_profilepic', profile.avatar_url);
            localStorage.setItem('moonpop_profilepic_owner', currentAuthUser.id);
            updateAvatarEverywhere(profile.avatar_url);
        } else if (localAvatar && isOwnAvatar) {
            // Local avatar belongs to this user, sync to profile
            updateAvatarEverywhere(localAvatar);
            syncAvatarToSupabase(localAvatar);
        } else {
            // No avatar, or local avatar belongs to different user — clear it
            localStorage.removeItem('moonpop_profilepic');
            localStorage.removeItem('moonpop_profilepic_owner');
            updateAvatarEverywhere(null);
        }
        console.log('[initAuth] Loading blocked users...');
        await loadBlockedUsers();
        console.log('[initAuth] Blocked users:', blockedUserIds.size);

        console.log('[initAuth] Loading contacts...');
        await loadContacts();
        console.log('[initAuth] Contacts loaded:', contacts.length);

        console.log('[initAuth] Loading messages...');
        await loadMessages();
        console.log('[initAuth] Messages loaded:', messages.length, 'conversations:', conversations.length);

        // Auto-create contacts for anyone in conversations but not in contacts
        await syncConversationContacts();

        await loadSharedSky();
        await loadMoonCircles();

        console.log('[initAuth] Rendering UI...');
        await loadInTransitReplies();
        // Load roulette messages on startup so they appear in the inbox immediately
        if (typeof loadRouletteMessages === 'function') await loadRouletteMessages();
        renderMessages();
        if (typeof showInboxWipeBanner === 'function') showInboxWipeBanner();
        renderMessageDots();
        renderCircleRows();
        renderContactsList();
        // Initialize received count baseline for notification detection
        _lastKnownReceivedCount = messages.filter(m => m.type === 'received').length;
        updateSoundToggleBtn();
        setupRealtimeMessages();
        if (typeof subscribeRouletteRealtime === 'function') subscribeRouletteRealtime();

        // Mark data as loaded — prevents re-initialization
        _appDataLoaded = true;
        console.log('[initAuth] SUCCESS — contacts:', contacts.length, 'messages:', messages.length, 'conversations:', conversations.length);

        // Auto-release in-transit messages if moon is already up on page load
        if (moonData.isVisible) {
            autoReleaseInTransitMessages();
        }

        const previewEl = document.getElementById('sharedSkyPreview');
        const badgeEl = document.getElementById('sharedSkyBadge');
        if (globalTransmissions.length > 0) {
            const latest = globalTransmissions[0];
            if (previewEl) previewEl.textContent = latest.location + ': ' + latest.message;
            updateSharedSkyBadge();
        } else {
            if (previewEl) previewEl.textContent = 'No messages yet — be the first!';
            if (badgeEl) { badgeEl.textContent = ''; badgeEl.style.display = 'none'; }
        }

        // Deep-link: route based on URL path
        const initPath = window.location.pathname;
        const chatMatch = initPath.match(/\/chat\/([a-f0-9-]+)/);
        if (initPath === '/philosophy') {
            openPhilosophyPage(true);
        } else if (initPath === '/contacts') {
            openContactsPage(true);
        } else if (initPath === '/shared-sky') {
            openSharedSkyModal(true);
        } else if (initPath === '/new-message') {
            openNewMessagePicker();
            // Replace state so it doesn't double-push
            history.replaceState({ page: 'new-message' }, '', '/new-message');
        } else if (chatMatch) {
            const chatId = chatMatch[1];
            const convIdx = conversations.findIndex(c => c.dbConversationId === chatId);
            if (convIdx !== -1) {
                console.log('[deeplink] Opening conversation:', chatId);
                await openConversation(convIdx);
            } else {
                console.warn('[deeplink] Conversation not found:', chatId);
                history.replaceState(null, '', '/');
            }
        }

        // Landing-hero "write first" hook: if the user arrived by composing in the hero
        // and just finished signup/login, send their pending message now so it lands in
        // their inbox. No-ops when there is no pending draft.
        if (typeof flushPendingSend === 'function') {
            try { await flushPendingSend(); } catch (e) { console.error('[initAuth] flushPendingSend failed:', e); }
        }
    } else {
        console.log('[initAuth] No session found, showing onboarding');
        showOnboarding();
    }

    } finally {
        _isInitializing = false;
    }
}

// ========================
