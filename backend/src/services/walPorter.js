/**
 * services/walPorter.js — WAL 检查点监控
 *
 * 平时保持 SQLite 默认 PASSIVE autocheckpoint；每 intervalMs 检查一次 `-wal` 文件大小，
 * 超过阈值时主动执行 `PRAGMA wal_checkpoint(RESTART)`，回收 WAL 并截断 `-wal`。
 * RESTART 在写事务期间会返回 SQLITE_BUSY：捕获、记日志，等下一轮再试（不发常态、不中断）。
 */
import fs from 'node:fs';
import { getConnection } from '../db.js';

export function startWalMonitor({
  dbPath,
  thresholdBytes = 20 * 1024 * 1024,
  intervalMs = 5000,
} = {}) {
  const walPath = `${dbPath}-wal`;
  let timer = null;
  let stopped = false;

  function check() {
    if (stopped) return;
    let size = 0;
    try {
      size = fs.statSync(walPath).size;
    } catch {
      // -wal 尚不存在或瞬态不可读：跳过本轮
      return;
    }
    if (size <= thresholdBytes) return;

    const db = getConnection(dbPath);
    try {
      const { busy } = db.prepare('PRAGMA wal_checkpoint(RESTART)').get();
      if (busy !== 0) {
        // 有读者/写事务未释放，无法 RESTART；下一轮再试
        console.warn(`[walPorter] checkpoint(RESTART) busy=${busy} (wal=${size}B), retry later`);
      } else {
        console.log(`[walPorter] RESTART checkpoint done (was ${size}B)`);
      }
    } catch (err) {
      console.warn('[walPorter] checkpoint(RESTART) error:', err && err.message);
    } finally {
      db.close();
    }
  }

  timer = setInterval(check, intervalMs);
  if (timer.unref) timer.unref();

  // 首次启动立即查一轮，避免等待整个 interval
  check();

  return {
    stop() {
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}