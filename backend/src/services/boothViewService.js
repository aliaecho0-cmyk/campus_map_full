import { withTransaction } from '../db.js';
import { findById as findEventById, isActive } from '../repositories/eventRepository.js';
import * as boothView from '../repositories/boothViewRepository.js';
import { findByEventIdAndCode as findBadge } from '../repositories/badgeRepository.js';
import * as userBadge from '../repositories/userBadgeRepository.js';
import { createBatchQueue } from './batchQueue.js';

const DEVICE_ID_RE = /^dev_\d+_[A-Za-z0-9]{8}$/;
const BADGE_CODE = 'knowitall';

// view_count 纯统计累加，异步批写（200ms / 攒满 maxBatch 先到先得，单事务批量 UPDATE）
const viewQueue = createBatchQueue({
  processor: (batch) =>
    withTransaction(
      (db) => boothView.incrementViewCountBatch(batch, db),
      { immediate: true }
    ),
  intervalMs: 200,
  maxBatch: 100,
});

/**
 * @typedef {object} BoothViewResult
 * @property {number} eventId
 * @property {number} uniqueBoothCount 该设备去重浏览摊位进度
 * @property {Array<{ code: string, unlocked: boolean, requiredUniqueBooths: number }>} badges 徽章进度
 */

function assertParams(eventId, boothId, deviceId) {
  if (!Number.isInteger(eventId) || eventId <= 0) throw new Error('INVALID_REQUEST');
  if (typeof boothId !== 'string' || boothId.trim() === '') throw new Error('INVALID_REQUEST');
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) throw new Error('INVALID_REQUEST');
}

function requireActiveEvent(eventId) {
  const event = findEventById(eventId);
  if (!event) throw new Error('EVENT_NOT_FOUND');
  if (!isActive(event)) throw new Error('EVENT_NOT_ACTIVE');
  return event;
}

function badgeProgress(badge, unlocked) {
  if (!badge) return [];
  return [
    {
      code: badge.code,
      unlocked,
      requiredUniqueBooths: badge.required_unique_booths,
    },
  ];
}

/**
 * 记录一次摊位浏览，并同事务判断/幂等解锁徽章（BACKEND_PLAN §8.1 / §8.2）。
 * 整个 upsert→计数→判断→解锁 在 withTransaction 内完成。
 * @param {number} eventId 活动 ID
 * @param {string} boothId 摊位标识
 * @param {string} deviceId 设备标识
 * @returns {BoothViewResult}
 * @throws {Error} 参数非法 → INVALID_REQUEST；活动不存在 → EVENT_NOT_FOUND；活动不可用 → EVENT_NOT_ACTIVE
 */
export function recordView(eventId, boothId, deviceId) {
  assertParams(eventId, boothId, deviceId);
  requireActiveEvent(eventId);

  return withTransaction((db) => {
    boothView.ensureRow(eventId, deviceId, boothId, db);
    const uniqueBoothCount = boothView.countDistinctBooths(eventId, deviceId, db);
    const badge = findBadge(eventId, BADGE_CODE, db);

    if (badge && uniqueBoothCount >= badge.required_unique_booths) {
      // 幂等：重复触发不会产生第二条解锁记录
      userBadge.unlock(deviceId, badge.id, db);
    }
    const unlocked = badge ? userBadge.isUnlocked(deviceId, badge.id, db) : false;

    // 纯统计累计（view_count+1, last_viewed_at）异步批写，不入事务、不阻塞返回
    viewQueue.push({ eventId, deviceId, boothId, ts: Date.now() });

    return {
      eventId,
      boothId,
      uniqueBoothCount,
      badges: badgeProgress(badge, unlocked),
    };
  });
}

/** 供 server.js 优雅退出时冲刷未落库的浏览统计 */
export function flushViewQueue() {
  viewQueue.flushNow();
}

/**
 * 查询当前浏览进度（只读，不记录浏览）。
 * @param {number} eventId 活动 ID
 * @param {string} deviceId 设备标识
 * @returns {BoothViewResult}
 * @throws {Error} 参数非法 → INVALID_REQUEST
 */
export function getProgress(eventId, deviceId) {
  if (!Number.isInteger(eventId) || eventId <= 0) throw new Error('INVALID_REQUEST');
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) throw new Error('INVALID_REQUEST');

  const uniqueBoothCount = boothView.countDistinctBooths(eventId, deviceId);
  const badge = findBadge(eventId, BADGE_CODE);
  const unlocked = badge ? userBadge.isUnlocked(deviceId, badge.id) : false;

  return {
    eventId,
    uniqueBoothCount,
    badges: badgeProgress(badge, unlocked),
  };
}
