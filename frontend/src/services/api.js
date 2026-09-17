/**
 * services/api.js — 网络层 + JWT 管理（web 版）
 *
 * 统一封装 fetch：
 * - BASE_URL 后端地址
 * - 自动从 localStorage 读取 JWT，加到 `Authorization: Bearer <token>`
 * - 自动设置 Content-Type: application/json
 * - 自动解析 JSON
 * - 后端返回 `{ error: { code, message } }` 时抛出带 code 的 {@link ApiError}
 *
 * 对应后端契约：backend/docs/API.md（v1.0）
 */
import { t } from '../i18n.js';
import { fetchJsonWithTimeout } from './http.js';

/** 后端基础地址。
 * - 开发（未设置 VITE_API_BASE）：默认打本地 3000。
 * - 生产：后端经反代暴露在与页面同源的 /api 下，且各请求路径本身已带 /api，
 *   故构建时用 `VITE_API_BASE=`（空串）让 BASE_URL 为空、走同源 /api，避免 /api 前缀重复。
 */
const __configuredBase = import.meta.env?.VITE_API_BASE;
export const BASE_URL = __configuredBase === undefined || __configuredBase === null ? 'http://localhost:3000' : String(__configuredBase);

/** localStorage 中 JWT 的存储 key */
const TOKEN_KEY = 'auth_token';
let authRevision = 0;

/** 错误码 → i18n key（对应 API 契约 §1.4 通用错误码） */
const ERROR_KEYS = {
  INVALID_REQUEST: 'err_INVALID_REQUEST',
  AUTH_REQUIRED: 'err_AUTH_REQUIRED',
  INVALID_TOKEN: 'err_INVALID_TOKEN',
  STAFF_REQUIRED: 'err_STAFF_REQUIRED',
  BADGE_NOT_UNLOCKED: 'err_BADGE_NOT_UNLOCKED',
  EVENT_NOT_FOUND: 'err_EVENT_NOT_FOUND',
  CLAIM_TOKEN_NOT_FOUND: 'err_CLAIM_TOKEN_NOT_FOUND',
  EVENT_NOT_ACTIVE: 'err_EVENT_NOT_ACTIVE',
  CLAIM_TOKEN_EXPIRED: 'err_CLAIM_TOKEN_EXPIRED',
  CLAIM_TOKEN_REDEEMED: 'err_CLAIM_TOKEN_REDEEMED',
  SQLITE_BUSY: 'err_SQLITE_BUSY',
};

/**
 * 自定义 API 错误。
 * 前端捕获后可依据 {@link ApiError#code} 做差异化处理。
 */
export class ApiError extends Error {
  /**
   * @param {string} code 后端错误码（网络异常时为 'NETWORK_ERROR'）
   * @param {string} message 人类可读的提示（随界面语言）
   * @param {number} [status] HTTP 状态码（网络异常时无）
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/* ---------- JWT 存取 ---------- */

/**
 * 读取当前 JWT。
 * @returns {string} 未登录时返回空字符串
 */
export function getAuthToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * 保存 JWT。
 * @param {string} token
 */
export function setAuthToken(token) {
  authRevision += 1;
  try {
    localStorage.setItem(TOKEN_KEY, token || '');
  } catch {}
}

/**
 * 清除 JWT（退出登录时调用）。
 */
export function clearAuthToken() {
  authRevision += 1;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

/* ---------- 通用 request ---------- */

/**
 * 发送请求并返回解析后的业务数据。
 *
 * @param {string} path 以 `/` 开头的接口路径，如 `/api/me/reward`
 * @param {object} [options]
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [options.method='GET']
 * @param {object} [options.body] 请求体，会 JSON 序列化并自动设置 Content-Type
 * @param {boolean} [options.auth=true] 是否携带 JWT（登录接口传 false）
 * @returns {Promise<any>} 成功时为业务数据（无 code/data 包裹）
 * @throws {ApiError} 请求失败或后端返回错误
 */
async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (auth) {
    const token = getAuthToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  const options = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  let response;
  let data;
  try {
    ({ response, data } = await fetchJsonWithTimeout(BASE_URL + path, options));
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new ApiError('REQUEST_TIMEOUT', t('requestTimeout'));
    }
    // fetch 层面失败（断网 / CORS / 后端未启动）统一抛出
    throw new ApiError('NETWORK_ERROR', t('networkError'));
  }

  if (!response.ok) {
    const code = data && data.error ? data.error.code : undefined;
    const serverMsg = data && data.error ? data.error.message : undefined;
    const message = code && ERROR_KEYS[code] ? t(ERROR_KEYS[code]) : serverMsg || t('networkError');
    throw new ApiError(code || `HTTP_${response.status}`, message, response.status);
  }

  return data;
}

/* ---------- 接口方法（对应 API 契约） ---------- */

/**
 * 学生自动登录（无感登录）。
 * 成功后自动保存 JWT 到 localStorage。
 *
 * @param {string} deviceId 设备标识，格式 `dev_<timestamp>_<8位随机>`
 * @returns {Promise<{token: string, user: {id: string, role: string}, eventEndAt: string}>}
 * @throws {ApiError} INVALID_REQUEST
 */
export async function studentLogin(deviceId) {
  const revision = authRevision;
  const data = await request('/api/auth/student', {
    method: 'POST',
    body: { deviceId },
    auth: false,
  });
  // A slow background login must not replace a newer staff session or logout.
  if (revision !== authRevision) return null;
  if (data && data.token) setAuthToken(data.token);
  return data;
}

/**
 * 工作人员登录。
 * 成功后自动保存 JWT 到 localStorage。
 *
 * @param {string} code 工作人员识别码（固定 `staff2026`）
 * @param {string} name 工作人员姓名（须在白名单中）
 * @returns {Promise<{token: string, user: {id: string, role: string}, eventEndAt: string}>}
 * @throws {ApiError} AUTH_REQUIRED（识别码错误或姓名不在白名单）
 */
export async function staffLogin(code, name) {
  const data = await request('/api/auth/staff', {
    method: 'POST',
    body: { code, name },
    auth: false,
  });
  if (data && data.token) setAuthToken(data.token);
  return data;
}

/**
 * 获取当前用户身份。
 *
 * @returns {Promise<{id: string, role: 'student'|'staff'}>}
 * @throws {ApiError} AUTH_REQUIRED / INVALID_TOKEN
 */
export function getMe() {
  return request('/api/auth/me');
}

/**
 * 浏览摊位埋点：记录去重浏览数，达到阈值自动解锁「百事通」徽章。
 *
 * @param {number|string} eventId 活动 ID（整数）
 * @param {string} boothId 摊位 ID（前端传入，后端不校验存在性）
 * @returns {Promise<{eventId: number, boothId: string, uniqueBoothCount: number, badges: Array}>}
 * @throws {ApiError} EVENT_NOT_FOUND / EVENT_NOT_ACTIVE / INVALID_REQUEST
 */
export function recordBoothView(eventId, boothId) {
  return request(`/api/events/${eventId}/booths/${boothId}/view`, { method: 'POST' });
}

/**
 * 获取我的奖励状态（徽章进度 + 领取码状态）。
 *
 * @returns {Promise<{badge: object, reward: object|null, eventEndAt: string}>}
 * @throws {ApiError} AUTH_REQUIRED / INVALID_TOKEN
 */
export function getRewardStatus() {
  return request('/api/me/reward');
}

/**
 * 获取 / 出示领取码（首签随机生成，未核销则复用）。
 *
 * @returns {Promise<{claimToken: string, claimStatus: string, eventEndAt: string}>}
 * @throws {ApiError} BADGE_NOT_UNLOCKED / EVENT_NOT_ACTIVE / CLAIM_TOKEN_EXPIRED / CLAIM_TOKEN_REDEEMED
 */
export function getClaimToken() {
  return request('/api/me/claim-token', { method: 'POST' });
}

/**
 * 查询领取码状态（只读，永不创建领取码）。
 *
 * @returns {Promise<{claimStatus: 'none'|'active'|'redeemed', claimToken: string|null, eventEndAt: string, redeemedAt: string|null}>}
 * @throws {ApiError} AUTH_REQUIRED / INVALID_TOKEN
 */
export function getClaimTokenStatus() {
  return request('/api/me/claim-token');
}

/**
 * 工作人员核销领取码（核验 + 核销 + 发奖）。
 *
 * @param {string} claimToken 学生出示的领取码明文
 * @returns {Promise<{success: boolean, claimTokenStatus: string, redeemedAt: string, redeemedBy: object, reward: object}>}
 * @throws {ApiError} STAFF_REQUIRED / CLAIM_TOKEN_NOT_FOUND / CLAIM_TOKEN_EXPIRED / CLAIM_TOKEN_REDEEMED / EVENT_NOT_ACTIVE
 */
export function redeemClaimToken(claimToken) {
  return request('/api/staff/claim-tokens/redeem', {
    method: 'POST',
    body: { claimToken },
  });
}

/** 导出错误码 → i18n key 映射（供展示层按需使用） */
export const ERROR_CODE_KEYS = ERROR_KEYS;
