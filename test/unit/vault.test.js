'use strict';
// Encryption at rest (vault.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { TEST_DATA_KEY } = require('../helpers');

const vault = require('../../vault');

function withKey(key, fn) {
  const before = process.env.DATA_ENCRYPTION_KEY;
  if (key === undefined) delete process.env.DATA_ENCRYPTION_KEY;
  else process.env.DATA_ENCRYPTION_KEY = key;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.DATA_ENCRYPTION_KEY;
    else process.env.DATA_ENCRYPTION_KEY = before;
  }
}

const SAMPLE = JSON.stringify({ tasks: [{ id: 't1', title: 'Renew passport' }] });

test('sealed data reads back exactly and hides the plaintext', () => {
  withKey(TEST_DATA_KEY, () => {
    const sealed = vault.seal('alice', SAMPLE);
    assert.ok(sealed.startsWith('enc:v1:'));
    assert.ok(!sealed.includes('passport'));
    assert.equal(vault.open('alice', sealed), SAMPLE);
  });
});

test('the same data encrypts differently each time (fresh IV)', () => {
  withKey(TEST_DATA_KEY, () => {
    assert.notEqual(vault.seal('alice', SAMPLE), vault.seal('alice', SAMPLE));
  });
});

test("one account's ciphertext can't be opened as another account", () => {
  withKey(TEST_DATA_KEY, () => {
    const sealed = vault.seal('alice', SAMPLE);
    assert.throws(() => vault.open('bob', sealed), { status: 503 });
  });
});

test('tampered ciphertext is rejected', () => {
  withKey(TEST_DATA_KEY, () => {
    const sealed = vault.seal('alice', SAMPLE);
    const raw = Buffer.from(sealed.slice('enc:v1:'.length), 'base64');
    raw[raw.length - 1] ^= 1; // flip one bit of the encrypted body
    assert.throws(() => vault.open('alice', 'enc:v1:' + raw.toString('base64')), { status: 503 });
  });
});

test('a different key cannot decrypt', () => {
  const sealed = withKey(TEST_DATA_KEY, () => vault.seal('alice', SAMPLE));
  withKey('another-key-0123456789abcdef0123456789abc', () => {
    assert.throws(() => vault.open('alice', sealed), /couldn't be decrypted/);
  });
});

test('plain records written before encryption still read', () => {
  withKey(TEST_DATA_KEY, () => {
    assert.equal(vault.open('alice', SAMPLE), SAMPLE);
    assert.equal(vault.open('alice', null), null);
  });
});

test('without a key, data is stored as-is but encrypted data refuses to open', () => {
  const sealed = withKey(TEST_DATA_KEY, () => vault.seal('alice', SAMPLE));
  withKey(undefined, () => {
    assert.equal(vault.isEnabled(), false);
    assert.equal(vault.seal('alice', SAMPLE), SAMPLE);
    assert.throws(() => vault.open('alice', sealed), { status: 503, message: /DATA_ENCRYPTION_KEY is not set/ });
  });
});

test('a too-short key is refused rather than used', () => {
  withKey('short', () => {
    assert.throws(() => vault.seal('alice', SAMPLE), /at least 32 characters/);
  });
});
