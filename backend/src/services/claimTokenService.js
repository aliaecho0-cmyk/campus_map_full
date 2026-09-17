import { randomBytes, createHash } from 'node:crypto';
import { withTransaction } from '../db.js';
import { getCurrentEvent, isActive } from '../repositories/eventRepository.js';
import { findByEventIdAndCode as findBadge } from '../repositories/badgeRepository.js';
import * as boothView from '../repositories/boothViewRepository.js';
import { isUnlocked } from '../repositories/userBadgeRepository.js';
import * as claimToken from '../repositories/claimTokenRepository.js';

const DEVICE_ID_RE = /^dev_\d+_[A-Za-z0-9]{8}$/;
const BADGE_CODE = 'knowitall';
const REWARD_CODE = 'free-drink';
// 领取码字符集：A-Z + 0-9，剔除易混淆的 0/O、1/I/L（docs/api.md 附录 8）
const CLAIM_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const TOKEN_GROUPS = 4;
const GROUP_LENGTH = 4;

function assertDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
    throw new Error('INVALID_REQUEST');
  }
}

function currentEventOrThrow() {
  const event = getCurrentEvent();
  if (!event) throw new Error('EVENT_NOT_FOUND');
  return event;
}

function toIso(epochSeconds) {
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * 生成 XXXX-XXXX-XXXX-XXXX 格式的随机领取码（密码学安全随机源）。
 * @returns {string}
 */
export function generateClaimToken() {
  const bytes = randomBytes(TOKEN_GROUPS * GROUP_LENGTH);
  const chars = Array.from(bytes, (b) => CLAIM_CHARSET[b % CLAIM_CHARSET.length]);
  const groups = [];
  for (let i = 0; i < TOKEN_GROUPS; i++) {
    groups.push(chars.slice(i * GROUP_LENGTH, (i + 1) * GROUP_LENGTH).join(''));
  }
  return groups.join('-');
}

/**
 * 计算领取码的 SHA-256 哈希（用于数据库按码查询，不保存明文哈希以外的可逆信息）。
 * @param {string} token 领取码明文
 * @returns {string} hex 哈希
 */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * @typedef {object} BadgeProgress
 * @property {string} code
 * @property {string | null} name
 * @property {boolean} unlocked
 * @property {number} requiredUniqueBooths
 * @property {number} uniqueBoothCount
 */

/**
 * @typedef {object} RewardState
 * @property {'none' | 'active' | 'redeemed' | 'expired'} claimStatus
 * @property {string | null} claimToken 仅在 active 时返回明文
 * @property {string | null} redeemedAt 仅在 redeemed 时有值
 */

/**
 * 查看奖励状态（对应 GET /api/me/reward，API 契约 §4.1）。
 * 只读，永不创建领取码。
 * @param {string} deviceId 设备标识
 * @returns {{ badge: BadgeProgress, reward: ({ code: string } & RewardState) | null, eventEndAt: string }}
 * @throws {Error} deviceId 非法 → INVALID_REQUEST；无当前活动 → EVENT_NOT_FOUND
 */
export function getRewardStatus(deviceId) {
  assertDeviceId(deviceId);
  const event = currentEventOrThrow();
  const eventActive = isActive(event);
  const badge = findBadge(event.id, BADGE_CODE);
  const uniqueBoothCount = boothView.countDistinctBooths(event.id, deviceId);
  const unlocked = badge ? isUnlocked(deviceId, badge.id) : false;
  const row = unlocked ? claimToken.findByDeviceId(deviceId) : null;

  let claimStatus = null;
  let claimTokenPlain = null;
  let redeemedAt = null;
  if (unlocked) {
    if (row && row.status === 'redeemed') {
      claimStatus = 'redeemed';
      redeemedAt = row.redeemed_at;
    } else if (!eventActive) {
      claimStatus = 'expired';
    } else if (row) {
      claimStatus = 'active';
      claimTokenPlain = row.token_ciphertext;
    } else {
      claimStatus = 'none';
    }
  }

  return {
    badge: {
      code: BADGE_CODE,
      name: badge ? badge.name : null,
      unlocked,
      requiredUniqueBooths: badge ? badge.required_unique_booths : 0,
      uniqueBoothCount,
    },
    reward: unlocked
      ? { code: REWARD_CODE, claimStatus, claimToken: claimTokenPlain, redeemedAt }
      : null,
    eventEndAt: toIso(event.end_at),
  };
}

/**
 * 获取 / 出示领取码：首次随机生成并幂等首签，已存在则复用同一个码（POST /api/me/claim-token，§4.2 / §9.2）。
 * @param {string} deviceId 设备标识
 * @returns {{ claimToken: string, claimStatus: 'active', eventEndAt: string }}
 * @throws {Error} deviceId 非法 → INVALID_REQUEST；活动不可用 → EVENT_NOT_ACTIVE；未解锁 → BADGE_NOT_UNLOCKED；已核销 → CLAIM_TOKEN_REDEEMED
 */
export function getClaimToken(deviceId) {
  assertDeviceId(deviceId);
  const event = getCurrentEvent();
  if (!event || !isActive(event)) throw new Error('EVENT_NOT_ACTIVE');
  const badge = findBadge(event.id, BADGE_CODE);
  if (!badge || !isUnlocked(deviceId, badge.id)) {
    throw new Error('BADGE_NOT_UNLOCKED');
  }

  // 首签 + 读取放入同一事务；insertIgnore 由 UNIQUE(device_id) 兜底并发。
  // immediate：以写者身份开启，避免“读后升级写”触发 SQLITE_BUSY_SNAPSHOT。
  const row = withTransaction((db) => {
    const existing = claimToken.findByDeviceId(deviceId, db);
    if (existing) return existing;
    const token = generateClaimToken();
    claimToken.insertIgnore(deviceId, hashToken(token), token, db);
    return claimToken.findByDeviceId(deviceId, db);
  }, { immediate: true });

  if (row.status === 'redeemed') throw new Error('CLAIM_TOKEN_REDEEMED');
  return { claimToken: row.token_ciphertext, claimStatus: 'active', eventEndAt: toIso(event.end_at) };
}

/**
 * 查询领取码状态（只读，绝不首签；GET /api/me/claim-token，§4.3 / §9.3）。
 * @param {string} deviceId 设备标识
 * @returns {{ claimStatus: 'none' | 'active' | 'redeemed', claimToken: string | null, eventEndAt: string, redeemedAt: string | null }}
 * @throws {Error} deviceId 非法 → INVALID_REQUEST；无当前活动 → EVENT_NOT_FOUND
 */
export function getClaimTokenStatus(deviceId) {
  assertDeviceId(deviceId);
  const event = currentEventOrThrow();
  const row = claimToken.findByDeviceId(deviceId);
  const eventEndAt = toIso(event.end_at);
  if (!row) {
    return { claimStatus: 'none', claimToken: null, eventEndAt, redeemedAt: null };
  }
  if (row.status === 'redeemed') {
    return { claimStatus: 'redeemed', claimToken: null, eventEndAt, redeemedAt: row.redeemed_at };
  }
  return { claimStatus: 'active', claimToken: row.token_ciphertext, eventEndAt, redeemedAt: null };
}
