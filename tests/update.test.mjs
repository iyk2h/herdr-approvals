import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION, isNewer, parseRelease, UpdateController } from '../mods/approvals/updater.js';

const repo = 'https://github.com/iyk2h/herdr-approvals';
const interval = 6 * 60 * 60 * 1000;
function release(version = '0.3.0', extra = {}) {
  const tag = `v${version}`;
  const download = `${repo}/releases/download/${tag}`;
  return {
    tag_name: tag, draft: false, prerelease: false,
    html_url: `${repo}/releases/tag/${tag}`,
    body: '- Add update controls.\n- Preserve settings.',
    assets: [
      { name: `herdr-approval-${version}.zip`, browser_download_url: `${download}/herdr-approval-${version}.zip` },
      { name: `herdr-approval-${version}.zip.sha256`, browser_download_url: `${download}/herdr-approval-${version}.zip.sha256` },
    ],
    ...extra,
  };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function refuses(payload) {
  try { assert.equal(parseRelease(payload), null, 'an invalid release must not become an install choice'); }
  catch (error) { if (error.code === 'ERR_ASSERTION') throw error; }
}

test('the updater identifies its release and compares numeric stable versions', () => {
  assert.equal(VERSION, JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
  assert.equal(isNewer('0.10.0', '0.9.9'), true);
  assert.equal(isNewer('v1.0.0', '0.99.99'), true);
  assert.equal(isNewer('0.2.0', 'v0.2.0'), false);
  assert.equal(isNewer('0.1.99', '0.2.0'), false);
});

test('a published release supplies only canonical matching archive and checksum links', () => {
  const payload = release(), parsed = parseRelease(payload);
  assert.equal(parsed.version, '0.3.0');
  assert.equal(parsed.tag, 'v0.3.0');
  assert.equal(parsed.url, payload.html_url);
  assert.equal(parsed.notes, payload.body);
  assert.equal(parsed.archiveUrl, payload.assets[0].browser_download_url);
  assert.equal(parsed.checksumUrl, payload.assets[1].browser_download_url);
  assert.equal(parsed.available, true);
  assert.equal(parseRelease(release('0.2.0')).available, false);
  assert.equal(parseRelease(release('0.1.0')).available, false);
});

test('drafts, prereleases, malformed tags and oversized notes cannot be offered', () => {
  for (const change of [
    { draft: true }, { prerelease: true }, { tag_name: 'v0.3.0-rc.1' },
    { tag_name: 'v0.3.0/next' }, { tag_name: 'v0.3' },
    { body: 'x'.repeat(20 * 1024 + 1) },
  ]) refuses(release('0.3.0', change));
});

test('foreign, insecure, redirected and mismatched asset locations cannot be offered', () => {
  for (const url of [
    'https://github.com/another/repository/releases/tag/v0.3.0',
    'https://github.com.evil.example/iyk2h/herdr-approvals/releases/tag/v0.3.0',
    'http://github.com/iyk2h/herdr-approvals/releases/tag/v0.3.0',
  ]) refuses(release('0.3.0', { html_url: url }));
  for (const url of [
    'https://example.invalid/download.zip',
    `${repo}/releases/download/v0.4.0/herdr-approval-0.3.0.zip`,
    `${repo}/releases/download/v0.3.0/herdr-approval-0.3.0.zip?redirect=1`,
  ]) {
    const payload = release(); payload.assets[0].browser_download_url = url; refuses(payload);
  }
  for (const assets of [[], release().assets.slice(0, 1), [...release().assets, release().assets[0]]]) {
    refuses(release('0.3.0', { assets }));
  }
});

test('checking never installs a release and successful checks respect the six-hour interval', async () => {
  let time = 1000, reads = 0, installs = 0;
  const updates = new UpdateController({ now: () => time, host: {
    latest: async () => { reads++; return release(); },
    install: async () => { installs++; },
  } });
  assert.equal(updates.phase, 'idle');
  assert.equal(reads, 0, 'construction must not start network IO');
  await updates.check();
  assert.equal(updates.phase, 'available');
  assert.equal(updates.checkedAt, time);
  assert.equal(installs, 0);
  time += interval - 1;
  await updates.check();
  assert.equal(reads, 1);
  time++;
  await updates.check();
  assert.equal(reads, 2);
  await updates.check({ force: true });
  assert.equal(reads, 3);
  assert.equal(installs, 0);
});

test('concurrent checks share one request even when forced', async () => {
  const pending = deferred(); let reads = 0;
  const updates = new UpdateController({ host: { latest: () => { reads++; return pending.promise; } } });
  const first = updates.check(), second = updates.check({ force: true });
  assert.equal(reads, 1);
  assert.equal(updates.phase, 'checking');
  pending.resolve(release());
  await Promise.all([first, second]);
  assert.equal(updates.phase, 'available');
});

test('a failed check is neither cached nor reported as up to date', async () => {
  let reads = 0;
  const updates = new UpdateController({ host: { latest: async () => {
    if (++reads === 1) throw new Error('Fixture network unavailable');
    return release();
  } } });
  await updates.check();
  assert.equal(updates.phase, 'error');
  assert.ok(updates.error);
  assert.equal(updates.checkedAt, null);
  await updates.check();
  assert.equal(reads, 2, 'a failed request must be immediately retryable');
  assert.equal(updates.phase, 'available');
});

test('an invalid release after an available result cannot leave an installable stale choice', async () => {
  let payload = release(), installs = 0;
  const updates = new UpdateController({ host: { latest: async () => payload, install: async () => { installs++; } } });
  await updates.check();
  payload = release('0.3.0', { html_url: 'https://example.invalid/release' });
  await updates.check({ force: true });
  assert.notEqual(updates.phase, 'available');
  await updates.install();
  assert.equal(installs, 0);
});

test('no published release differs from a verified current version and cannot install', async () => {
  for (const [payload, phase] of [[null, 'unpublished'], [release('0.2.0'), 'current'], [release('0.1.0'), 'current']]) {
    let installs = 0;
    const updates = new UpdateController({ host: { latest: async () => payload, install: async () => { installs++; } } });
    await updates.check();
    assert.equal(updates.phase, phase);
    await updates.install();
    assert.equal(installs, 0);
  }
});

test('installation requires a reviewed available release and an idle approval controller', async () => {
  let idle = false, installs = 0;
  const updates = new UpdateController({ canInstall: () => idle, host: {
    latest: async () => release(), install: async value => { installs++; return { version: value.version, backup: '/fixture/backup' }; },
  } });
  await updates.install();
  assert.equal(installs, 0, 'install without a check must do nothing');
  await updates.check();
  await updates.install();
  assert.equal(installs, 0, 'pending approval work must block installation');
  idle = true;
  await updates.install();
  assert.equal(installs, 1);
  assert.equal(updates.phase, 'installed');
  assert.equal(updates.result.version, '0.3.0');
  assert.equal(updates.result.backup, '/fixture/backup');
});

test('double-clicks and a forced check during installation cannot start competing work', async () => {
  const pending = deferred(); let installs = 0, reads = 0;
  const updates = new UpdateController({ host: {
    latest: async () => { reads++; return release(); },
    install: () => { installs++; return pending.promise; },
  } });
  await updates.check();
  const first = updates.install(), second = updates.install();
  assert.equal(updates.phase, 'installing');
  await updates.check({ force: true });
  assert.equal(reads, 1);
  assert.equal(installs, 1);
  pending.resolve({ version: '0.3.0', backup: '/fixture/backup' });
  await Promise.all([first, second]);
  assert.equal(updates.phase, 'installed');
});

test('failed installation keeps the reviewed release available for an explicit retry', async () => {
  let installs = 0;
  const updates = new UpdateController({ host: {
    latest: async () => release(), install: async value => {
      if (++installs === 1) throw new Error('Fixture candidate validation failed');
      return { version: value.version, backup: '/fixture/backup' };
    },
  } });
  await updates.check();
  await updates.install();
  assert.notEqual(updates.phase, 'installed');
  assert.ok(updates.error);
  assert.equal(updates.release.version, '0.3.0');
  await updates.install();
  assert.equal(installs, 2);
  assert.equal(updates.phase, 'installed');
});

test('an unexpected installed version is an error rather than a false success', async () => {
  const updates = new UpdateController({ host: {
    latest: async () => release(), install: async () => ({ version: '0.1.0', backup: '/fixture/backup' }),
  } });
  await updates.check();
  await updates.install();
  assert.equal(updates.phase, 'error');
  assert.ok(updates.error);
});
