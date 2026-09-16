/**
 * services/auth.js — 学生无感登录（web 版）
 *
 * 职责：
 * - 管理 deviceId（读取 / 生成 / 持久化）
 * - ensureLogin()：已有有效 token 则跳过，否则调 studentLogin
 * - 失败时非阻断降级：页面顶部提示条（不弹窗、不阻塞浏览）
 *
 * 依赖：services/api.js（studentLogin / getAuthToken / setAuthToken / clearAuthToken）
 */

import { ApiError, getAuthToken, clearAuthToken, studentLogin } from './api.js';
import { state } from '../state.js';
import { t } from '../i18n.js';

/** localStorage key */
const DEVICE_ID_KEY = 'device_id';
const EVENT_END_AT_KEY = 'event_end_at';
const USER_KEY = 'auth_user';

/** deviceId 合法格式：dev_<秒级时间戳>_<8位大写/小写字母或数字> */
const DEVICE_ID_RE = /^dev_\d+_[A-Za-z0-9]{8}$/;

/** 生成中的登录请求（去重，避免重复调用） */
let inFlight = null;
let lastLoginError = null;

/* ---------- 存储助手（与 adapter/wx.js 的 storage 语义一致） ---------- */

function lsGet(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function lsSet(key, val) {
  try {
    localStorage.setItem(key, String(val));
  } catch {}
}

function lsRemove(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

/* ---------- deviceId ---------- */

/**
 * 读取 deviceId；不存在 / 格式不合法时生成一个并持久化。
 * @returns {string} 形如 `dev_1730000000_a8f3k2XY`
 */
export function getOrCreateDeviceId() {
  let id = lsGet(DEVICE_ID_KEY);
  if (id && DEVICE_ID_RE.test(id)) return id;

  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let rnd = '';
  for (let i = 0; i < 8; i += 1) {
    rnd += chars[Math.floor(Math.random() * chars.length)];
  }
  id = `dev_${Math.floor(Date.now() / 1000)}_${rnd}`;
  lsSet(DEVICE_ID_KEY, id);
  return id;
}

/* ---------- eventEndAt ---------- */

/**
 * 读取活动截止时间（ISO 8601 字符串）。
 * @returns {string} 未存储时为空字符串
 */
export function getEventEndAt() {
  return lsGet(EVENT_END_AT_KEY);
}

/** 存储活动截止时间（登录成功时由 ensureLogin 写入） */
function setEventEndAt(endAt) {
  if (endAt) lsSet(EVENT_END_AT_KEY, endAt);
  else lsRemove(EVENT_END_AT_KEY);
}

/* ---------- 用户信息 ---------- */

/** 把用户信息写入全局 state，并持久化一份以便重启后回显 */
function persistUser(user) {
  if (state) state.user = user || null;
  if (user) lsSet(USER_KEY, JSON.stringify(user));
  else lsRemove(USER_KEY);
}

/** 从持久化数据恢复用户到 state（token 有效、跳过登录时用） */
function restoreUser() {
  const raw = lsGet(USER_KEY);
  if (raw) {
    try {
      if (state) state.user = JSON.parse(raw);
    } catch {}
  }
}

/* ---------- 登录 ---------- */

/**
 * 判断当前 token 是否可视为有效（未过期）。
 * 有 token 且（无截止记录 或 未到截止时间）即认为有效。
 * @returns {boolean}
 */
function isTokenFresh() {
  if (!getAuthToken()) return false;
  const endAt = getEventEndAt();
  if (!endAt) return true; // 无截止记录，无法判断过期，视为有效
  const t = Date.parse(endAt);
  return !Number.isFinite(t) || t > Date.now();
}

/** 非阻断提示条：固定在页面顶部，自动消失 */
function showNotice(message) {
  let bar = document.getElementById('auth-notice');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'auth-notice';
    bar.setAttribute('role', 'status');
    bar.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;padding:10px 14px;' +
      'background:#3a2a4d;color:#f4e9ff;font-size:13px;line-height:1.4;text-align:center;';
    document.body.appendChild(bar);
  }
  bar.textContent = message;
  clearTimeout(showNotice._timer);
  showNotice._timer = setTimeout(() => {
    if (bar.parentNode) bar.parentNode.removeChild(bar);
  }, 5000);
}

/** 只读接口，供展示层判断是否需要提示 */
const NOTICEABLE_CODES = new Set(['EVENT_NOT_ACTIVE', 'EVENT_NOT_FOUND', 'NETWORK_ERROR', 'REQUEST_TIMEOUT']);

/**
 * 确保已登录（学生无感登录）。
 *
 * - 已有有效 token → 跳过网络请求，直接返回
 * - 无 token / token 已过期 → 调 studentLogin，成功后自动存 token 与 eventEndAt
 * - 失败（活动未开启 / 不存在 / 后端未启动等）→ 顶部提示条，返回 null，不阻塞
 *
 * 内部用 inFlight 去重，router 切换不会重复触发。
 * @returns {Promise<object|null>} user 信息；失败或跳过时返回已有 user，否则 null
 */
export function ensureLogin() {
  if (inFlight) return inFlight;

  if (getAuthToken()) {
    if (isTokenFresh()) {
      restoreUser();
      return Promise.resolve((state && state.user) || null);
    }
    // token 已过期：清掉，走重新登录
    clearAuthToken();
  }

  inFlight = (async () => {
    try {
      const res = await studentLogin(getOrCreateDeviceId());
      if (!res || getAuthToken() !== res.token) return (state && state.user) || null;
      lastLoginError = null;
      setEventEndAt(res.eventEndAt);
      persistUser(res.user || null);
      return (state && state.user) || null;
    } catch (e) {
      lastLoginError = e;
      if (e && e.code && NOTICEABLE_CODES.has(e.code)) {
        showNotice(e.message || t('networkError'));
      }
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Only API-dependent features await login; static pages remain available. */
export async function requireLogin() {
  const user = await ensureLogin();
  if (!getAuthToken()) {
    throw lastLoginError || new ApiError('AUTH_REQUIRED', t('err_AUTH_REQUIRED'));
  }
  return user;
}

/** 退出登录，保留 deviceId 以维持设备身份。 */
export function logout() {
  clearAuthToken();
  lsRemove(EVENT_END_AT_KEY);
  lsRemove(USER_KEY);
  lsRemove('user_role');
  if (state) state.user = null;
}
