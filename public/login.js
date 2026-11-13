'use strict';
// Sign-in page: asks the server whether login is on, signs in with Google
// through Firebase, and trades Firebase's ID token for our session cookie.

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
      buttonSlot.disabled = false;
      return;
    }
    location.replace('/');
  } catch {
    buttonSlot.disabled = false;
    showFailure("Couldn't reach the server. Check your connection and try again.");
  }
}

let firebase = null; // Firebase Auth SDK + auth, once loaded

// Trade the Firebase sign-in for our own session cookie, then forget Firebase's
// copy so this browser only holds one session.
async function finishSignIn(user) {
  const idToken = await user.getIdToken();
  await submitCredential(idToken);
  try {
    await firebase.auth.signOut();
  } catch {
    /* nothing to clean up */
  }
}

function friendlyError(err) {
  switch (err && err.code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled. Try again when you are ready.';
    case 'auth/unauthorized-domain':
      return `This address (${location.hostname}) isn't allowed to sign in yet. Add it under Authentication > Settings > Authorized domains in Firebase.`;
    case 'auth/operation-not-allowed':
      return 'Google sign-in is not turned on in Firebase yet (Authentication > Sign-in method).';
    case 'auth/network-request-failed':
      return "Couldn't reach Google. Check your connection and try again.";
    case 'auth/account-exists-with-different-credential':
      return 'That email already uses a different sign-in method.';
    default:
      return 'Could not sign in with Google. Please try again.';
  }
}

async function signInWithGoogle() {
  buttonSlot.disabled = true;
  loginRetry.hidden = true;
  setLoginStatus('Opening Google…');
  const provider = new firebase.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    const result = await firebase.signInWithPopup(firebase.auth, provider);
    await finishSignIn(result.user);
  } catch (err) {
    if (err && err.code === 'auth/popup-blocked') {
      // Popups are blocked: do a full-page redirect instead and finish on return.
      try {
        await firebase.signInWithRedirect(firebase.auth, provider);
        return;
      } catch (redirectErr) {
        console.error('Google sign-in redirect failed:', redirectErr);
        setLoginStatus(friendlyError(redirectErr), true);
      }
    } else {
      console.error('Google sign-in failed:', err);
      setLoginStatus(friendlyError(err), true);
    }
    buttonSlot.disabled = false;
  }
}

async function startLogin() {
  loginRetry.hidden = true;
  setLoginStatus('');

  let config;
  try {
    config = await FirebaseClient.config();
  } catch {
    showFailure("Couldn't reach the server. Check your connection and try again.");
    return;
  }
  if (!config.enabled) {
    location.replace('/'); // login isn't set up; the app is open
    return;
  }

  const fine = document.querySelector('.login-fine');
  if (fine) {
    fine.textContent = config.cloudSync
      ? 'Your tasks, habits and journal are saved to your account, so you can open them from any device.'
      : 'Your tasks, habits and journal stay on this device. Signing in only unlocks the app.';
  }

  try {
    firebase = await FirebaseClient.load();
  } catch (err) {
    console.error('Could not load Firebase:', err);
    showFailure("Couldn't load Google sign-in. Check your connection or any content blocker, then try again.");
    return;
  }

  // Coming back from a redirect sign-in (used when popups are blocked).
  try {
    const result = await firebase.getRedirectResult(firebase.auth);
    if (result && result.user) {
      buttonSlot.disabled = true;
      await finishSignIn(result.user);
      return;
    }
  } catch (err) {
    console.error('Google redirect sign-in failed:', err);
    setLoginStatus(friendlyError(err), true);
  }

  buttonSlot.disabled = false;
}

// It covers the whole screen, so draw it small and at a gentler frame rate.
if (window.AnimatedBackground) AnimatedBackground.mount(document.getElementById('loginCanvas'), { scale: 0.2, fps: 24 });

buttonSlot.addEventListener('click', signInWithGoogle);
loginRetry.addEventListener('click', startLogin);
startLogin();
