'use strict';
// Loads Firebase Authentication on demand, from Google's CDN, using the public
// web config the server hands out. Shared by the sign-in page and Calendar.
// FirebaseClient.config() -> { enabled, firebase }, FirebaseClient.load() -> SDK + auth.
(function () {
  const VERSION = '11.9.1';
  const CDN = `https://www.gstatic.com/firebasejs/${VERSION}`;

  let configPromise = null;
  let sdkPromise = null;

  function config() {
    if (!configPromise) {
      configPromise = fetch('/api/auth/config')
        .then((res) => res.json())
        .catch((err) => {
          configPromise = null; // let the next call retry
          throw err;
        });
    }
    return configPromise;
  }

  function load() {
    if (!sdkPromise) {
      sdkPromise = (async () => {
        const { enabled, firebase } = await config();
        if (!enabled) throw new Error('Sign-in is not set up on this server.');
        const [appMod, authMod] = await Promise.all([
          import(`${CDN}/firebase-app.js`),
          import(`${CDN}/firebase-auth.js`),
        ]);
        const app = appMod.initializeApp(firebase);
        return { ...authMod, auth: authMod.getAuth(app) };
      })().catch((err) => {
        sdkPromise = null;
        throw err;
      });
    }
    return sdkPromise;
  }

  window.FirebaseClient = { config, load };
})();
