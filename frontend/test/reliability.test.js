import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchJsonWithTimeout } from '../src/services/http.js';
import { studentLogin, staffLogin, getAuthToken, clearAuthToken } from '../src/services/api.js';
import { ensureLogin, requireLogin, logout } from '../src/services/auth.js';
import { state } from '../src/state.js';

const storage = new Map();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
} });
const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test('deadline aborts a server that never returns headers', async (t) => {
  let observedSignal;
  t.mock.method(globalThis, 'fetch', (_, { signal }) => {
    observedSignal = signal;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  });
  await assert.rejects(fetchJsonWithTimeout('https://test.invalid/', {}, 15), { name: 'TimeoutError' });
  assert.equal(observedSignal.aborted, true);
});

test('deadline also covers a stalled response body', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_, { signal }) => ({
    ok: true, status: 200,
    json: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('body aborted')))),
  }));
  await assert.rejects(fetchJsonWithTimeout('https://test.invalid/', {}, 15), { name: 'TimeoutError' });
});

test('successful responses clear the timer; proxy HTML errors retain HTTP status', async (t) => {
  let signal;
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    signal = options.signal;
    return response({ ok: true });
  });
  const success = await fetchJsonWithTimeout('https://test.invalid/', {}, 15);
  assert.deepEqual(success.data, { ok: true });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(signal.aborted, false);
  globalThis.fetch = async () => new Response('<html>Bad Gateway</html>', { status: 502 });
  const failure = await fetchJsonWithTimeout('https://test.invalid/');
  assert.equal(failure.response.status, 502);
  assert.equal(failure.data, null);
});

test('delayed student login cannot replace a newer staff token', async (t) => {
  clearAuthToken();
  const pending = deferred();
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/student')) return pending.promise;
    return response({ token: 'staff-token', user: { role: 'staff', id: 'test-staff' } });
  });
  const student = studentLogin('dev_1000_abcdefgh');
  await staffLogin('test-only', 'test-staff');
  pending.resolve(response({ token: 'old-student-token' }));
  assert.equal(await student, null);
  assert.equal(getAuthToken(), 'staff-token');
});

test('logging out invalidates a still-pending student login', async (t) => {
  clearAuthToken();
  const pending = deferred();
  t.mock.method(globalThis, 'fetch', () => pending.promise);
  const student = studentLogin('dev_1000_abcdefgh');
  logout();
  pending.resolve(response({ token: 'old-student-token' }));
  assert.equal(await student, null);
  assert.equal(getAuthToken(), '');
});

test('reward/view login gates share the background login and restore identity once', async (t) => {
  storage.clear();
  logout();
  const pending = deferred();
  let requests = 0;
  t.mock.method(globalThis, 'fetch', () => { requests += 1; return pending.promise; });
  const background = ensureLogin();
  const reward = requireLogin();
  const view = requireLogin();
  assert.equal(requests, 1);
  const user = { id: 'dev_1000_abcdefgh', role: 'student' };
  pending.resolve(response({ token: 'student-token', user, eventEndAt: '2099-01-01T00:00:00Z' }));
  assert.deepEqual(await Promise.all([background, reward, view]), [user, user, user]);
  assert.deepEqual(state.user, user);
  assert.equal(getAuthToken(), 'student-token');
});

test('background auth does not overwrite newer stored staff identity', async (t) => {
  storage.clear();
  logout();
  const pending = deferred();
  t.mock.method(globalThis, 'fetch', async (url) => url.endsWith('/student')
    ? pending.promise : response({ token: 'staff-token', user: { id: 'staff', role: 'staff' } }));
  const background = ensureLogin();
  await staffLogin('test-only', 'staff');
  localStorage.setItem('auth_user', JSON.stringify({ id: 'staff', role: 'staff' }));
  localStorage.setItem('user_role', 'staff');
  pending.resolve(response({ token: 'student-token', user: { role: 'student' }, eventEndAt: '2099-01-01T00:00:00Z' }));
  await background;
  assert.equal(JSON.parse(localStorage.getItem('auth_user')).role, 'staff');
  assert.equal(getAuthToken(), 'staff-token');
  logout();
  assert.equal(localStorage.getItem('user_role'), null);
});
