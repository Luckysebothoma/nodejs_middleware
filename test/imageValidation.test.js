import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectImageType, parseProductId, etagMatches, sanitizeOriginalName, sha256Hex, MAX_IMAGE_BYTES } from '../utils/imageValidation.js';
import { PNG, JPEG, WEBP, GIF, SVG, TEXT_AS_PNG } from './helpers/fixtures.js';

test('detectImageType recognises JPEG, PNG and WebP by content', () => {
  assert.equal(detectImageType(JPEG), 'image/jpeg');
  assert.equal(detectImageType(PNG), 'image/png');
  assert.equal(detectImageType(WEBP), 'image/webp');
});

test('detectImageType rejects GIF, SVG, text and tiny buffers', () => {
  for (const b of [GIF, SVG, TEXT_AS_PNG, Buffer.alloc(0), Buffer.from([0xff, 0xd8, 0xff]), null, undefined]) {
    assert.equal(detectImageType(b), null);
  }
});

test('a RIFF container that is not WebP is rejected', () => {
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WAVEfmt '), Buffer.alloc(40)]);
  assert.equal(detectImageType(wav), null);
});

test('parseProductId accepts positive integers only', () => {
  assert.equal(parseProductId('7'), '7');
  assert.equal(parseProductId(' 123 '), '123');
  for (const bad of ['0', '-1', '1.5', 'abc', '', null, undefined, '1e3', '07', '12345678901234567890', "1;DROP TABLE x", '１２']) {
    assert.equal(parseProductId(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
});

test('etagMatches handles exact, weak, list and wildcard forms', () => {
  assert.ok(etagMatches('"abc"', '"abc"'));
  assert.ok(etagMatches('W/"abc"', '"abc"'));
  assert.ok(etagMatches('"x", "abc"', '"abc"'));
  assert.ok(etagMatches('*', '"abc"'));
  assert.ok(!etagMatches('"abd"', '"abc"'));
  assert.ok(!etagMatches(undefined, '"abc"'));
});

test('sanitizeOriginalName keeps a harmless base name', () => {
  assert.equal(sanitizeOriginalName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeOriginalName('C:\\x\\y\\Gum Mint.webp'), 'Gum Mint.webp');
  assert.equal(sanitizeOriginalName('a\u0000b.png'), 'ab.png');
  assert.equal(sanitizeOriginalName(''), null);
  assert.equal(sanitizeOriginalName('x'.repeat(400)).length, 255);
});

test('sha256Hex is the standard digest; limit is 5 MB', () => {
  assert.equal(sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(MAX_IMAGE_BYTES, 5242880);
});
