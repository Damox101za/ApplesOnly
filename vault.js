'use strict';
// Encrypts each person's synced data before it is stored (Upstash Redis on
// Vercel, data/store.json elsewhere), so someone who gets into the database
// sees only scrambled text.
//
// AES-256-GCM, with a key derived from DATA_ENCRYPTION_KEY. The record's owner
// is bound in as associated data, so one person's ciphertext can't be moved
// onto another account and still decrypt.
//
// Without DATA_ENCRYPTION_KEY, data is stored as plain JSON (as before). Plain
// records written before the key was set still read fine and are encrypted on
// their next save.

const crypto = require('crypto');

const PREFIX = 'enc:v1:';
const MIN_SECRET_CHARS = 32;

let warned = false;

function keyFor(secret) {
  return crypto.createHash('sha256').update(`lifetracker data v1\0${secret}`).digest();
}

// The key, or null when encryption is off. A too-short secret is a setup
// mistake, so it is refused loudly instead of being used.
function currentKey() {
  const secret = (process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (!secret) {
    if (!warned) {
      warned = true;
      console.warn('DATA_ENCRYPTION_KEY is not set: synced data is stored without encryption.');
    }
    return null;
  }
  if (secret.length < MIN_SECRET_CHARS) {
    throw Object.assign(new Error(`DATA_ENCRYPTION_KEY must be at least ${MIN_SECRET_CHARS} characters.`), { status: 500 });
  }
  return keyFor(secret);
}

const isEnabled = () => Boolean(currentKey());
const isSealed = (stored) => typeof stored === 'string' && stored.startsWith(PREFIX);

function seal(owner, plaintext) {
  const key = currentKey();
  if (!key) return plaintext;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(owner)));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

function open(owner, stored) {
  if (!isSealed(stored)) return stored; // plain JSON, or nothing stored yet
  const key = currentKey();
  if (!key) {
    throw Object.assign(new Error('Your synced data is encrypted, but DATA_ENCRYPTION_KEY is not set on the server.'), { status: 503 });
  }
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(String(owner)));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    throw Object.assign(new Error("Your synced data couldn't be decrypted. Has DATA_ENCRYPTION_KEY changed?"), { status: 503 });
  }
}

module.exports = { isEnabled, isSealed, seal, open };
