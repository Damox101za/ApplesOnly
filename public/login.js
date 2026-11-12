'use strict';
// Sign-in page: asks the server whether login is on, shows Google's button,
// and trades the ID token Google returns for our session cookie.

const loginStatus = document.getElementById('loginStatus');
const loginRetry = document.getElementById('loginRetry');
const buttonSlot = document.getElementById('googleButton');

function setLoginStatus(text, isError) {
  loginStatus.textContent = text;
  loginStatus.classList.toggle('error', Boolean(isError));
}

function showFailure(text) {
  setLoginStatus(text, true);
  loginRetry.hidden = false;
}

async function submitCredential(credential) {
  setLoginStatus('Signing you in…');
  loginRetry.hidden = true;
  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setLoginStatus(data.error || 'Sign-in failed. Please try again.', true);
      return;
    }
    location.replace('/');
  } catch {
    showFailure("Couldn't reach the server. Check your connection and try again.");
  }
}

function waitForGoogle(timeoutMs) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    (function poll() {
      if (window.google && google.accounts && google.accounts.id) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('timeout'));
      setTimeout(poll, 100);
    })();
  });
}

function prefersDark() {
  const theme = document.documentElement.dataset.theme;
  if (theme) return theme === 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

async function startLogin() {
  loginRetry.hidden = true;
  setLoginStatus('');

  let config;
  try {
    config = await (await fetch('/api/auth/config')).json();
  } catch {
    showFailure("Couldn't reach the server. Check your connection and try again.");
    return;
  }
  if (!config.enabled) {
    location.replace('/'); // login isn't set up; the app is open
    return;
  }

  try {
    await waitForGoogle(10000);
  } catch {
    showFailure("Couldn't load Google sign-in. Check your connection or any content blocker, then try again.");
    return;
  }

  google.accounts.id.initialize({
    client_id: config.clientId,
    callback: (response) => submitCredential(response.credential),
    auto_select: false,
  });
  buttonSlot.innerHTML = '';
  google.accounts.id.renderButton(buttonSlot, {
    theme: prefersDark() ? 'filled_black' : 'outline',
    size: 'large',
    shape: 'rectangular',
    text: 'signin_with',
    width: 280,
  });
}

// It covers the whole screen, so draw it small and at a gentler frame rate.
if (window.AnimatedBackground) AnimatedBackground.mount(document.getElementById('loginCanvas'), { scale: 0.2, fps: 24 });

loginRetry.addEventListener('click', startLogin);
startLogin();
