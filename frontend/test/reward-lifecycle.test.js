import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
register('./ignore-css.mjs', import.meta.url);
const { default: rewardPage } = await import('../src/pages/reward.js');
const { logout } = await import('../src/services/auth.js');

const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
} });
const response = (data) => new Response(JSON.stringify(data), {
  headers: { 'Content-Type': 'application/json' },
});
const settle = () => new Promise((resolve) => setImmediate(resolve));
function container() {
  const countdown = { textContent: '' };
  const badge = { innerHTML: '' };
  const claim = { innerHTML: '' };
  return { innerHTML: '', countdown, querySelector: (selector) => ({
    '.countdown-box': countdown, '.badge-body': badge, '.claim-body': claim,
  })[selector] || null };
}

test('a first reward visit keeps ticking after delayed login and is destroyable', async (t) => {
  storage.clear();
  logout();
  let now = Date.now();
  const eventEndAt = new Date(now + 6 * 3600000 + 180000).toISOString();
  t.mock.method(Date, 'now', () => now);
  let tick;
  let cleared;
  t.mock.method(globalThis, 'setInterval', (callback) => { tick = callback; return 42; });
  t.mock.method(globalThis, 'clearInterval', (id) => { cleared = id; });
  let finishLogin;
  const pendingLogin = new Promise((resolve) => { finishLogin = resolve; });
  t.mock.method(globalThis, 'fetch', async (url) => url.endsWith('/student') ? pendingLogin : response({
    eventEndAt, badge: { name: 'test', unlocked: false, requiredUniqueBooths: 20, uniqueBoothCount: 0 },
    reward: null,
  }));
  const view = container();
  const page = rewardPage.mount(view);
  assert.equal(typeof page.destroy, 'function');
  assert.equal(typeof tick, 'function', 'clock must exist before login supplies the deadline');
  const beforeLogin = view.countdown.textContent;
  finishLogin(response({ token: 'test-token', user: { id: 'test', role: 'student' }, eventEndAt }));
  await settle();
  const afterLogin = view.countdown.textContent;
  assert.notEqual(afterLogin, beforeLogin);
  now += 61000;
  tick();
  assert.notEqual(view.countdown.textContent, afterLogin);
  page.destroy();
  assert.equal(cleared, 42);
  assert.equal(view.innerHTML, '');
});

test('leaving rewards during login does not start its reward request later', async (t) => {
  storage.clear();
  logout();
  t.mock.method(globalThis, 'setInterval', () => 42);
  t.mock.method(globalThis, 'clearInterval', () => {});
  let finishLogin;
  const pendingLogin = new Promise((resolve) => { finishLogin = resolve; });
  const urls = [];
  t.mock.method(globalThis, 'fetch', (url) => { urls.push(url); return pendingLogin; });
  const view = container();
  const page = rewardPage.mount(view);
  page.destroy();
  finishLogin(response({ token: 'test-token', user: { role: 'student' }, eventEndAt: '2099-01-01T00:00:00Z' }));
  await settle();
  assert.equal(urls.length, 1);
  assert.ok(urls[0].endsWith('/api/auth/student'));
  assert.equal(view.innerHTML, '');
});
