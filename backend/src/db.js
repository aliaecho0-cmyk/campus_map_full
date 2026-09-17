import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

// backend 项目根目录（src/ 的上一级）
const DB_DIR = path.resolve(MODULE_DIR, '..');
const DEFAULT_DB_PATH = path.join(DB_DIR, 'database.db');

/**
 * 解析数据库文件路径。
 * 优先读环境变量 DATABASE_PATH（相对路径以 backend 根目录为基准），否则用默认路径。
 * @returns {string} 数据库文件绝对路径
 */
export function resolveDbPath() {
  const fromEnv = process.env.DATABASE_PATH;
  if (!fromEnv) return DEFAULT_DB_PATH;
  return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(DB_DIR, fromEnv);
}

// WAL 只在启动时首个连接执行一次（PASSIVE autocheckpoint 由 SQLite 维护）
let walInitialized = false;

/**
 * 应用启动时调用一次：将数据库文件切到 WAL 模式（文件级持久设置，幂等）。
 * 幂等：重复调用无害，但只执行一次后续连接不重复执行（BACKEND_PLAN 用户约束 #3）。
 * @returns {string} 当前 journal_mode
 */
export function initWAL() {
  if (walInitialized) return 'wal';
  const db = new DatabaseSync(resolveDbPath());
  try {
    const { journal_mode } = db.prepare('PRAGMA journal_mode = WAL').get();
    walInitialized = true;
    return journal_mode;
  } finally {
    db.close();
  }
}

/**
 * 打开一个新的数据库连接。
 * 每个连接建立时开启外键约束与忙等待超时（BACKEND_PLAN §13.4）。
 * @param {string} [dbPath] 数据库文件路径，缺省走 resolveDbPath()
 * @returns {import('node:sqlite').DatabaseSync} 已就绪的连接，用完需 close()
 */
export function getConnection(dbPath = resolveDbPath()) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/**
 * 在给定连接上执行 fn；未传入连接时自行开一个连接并在结束后关闭。
 * 供仓储层复用：事务内传 connection，事务外自动开关连接。
 * @param {import('node:sqlite').DatabaseSync | null | undefined} connection
 * @param {(db: import('node:sqlite').DatabaseSync) => unknown} fn
 * @returns {unknown}
 */
export function withDb(connection, fn) {
  if (connection) return fn(connection);
  const db = getConnection();
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * 在一个事务中执行 fn，成功提交、失败回滚。事务结束后关闭连接。
 * @param {(db: import('node:sqlite').DatabaseSync) => unknown} fn 事务体（同步执行）
 * @param {{ immediate?: boolean }} [options] immediate=true 时用 BEGIN IMMEDIATE（用于核销等先锁后读的写流程）
 * @returns {unknown} fn 的返回值
 */
export function withTransaction(fn, { immediate = false } = {}) {
  const db = getConnection();
  try {
    db.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 回滚失败时优先抛原始错误
    }
    throw err;
  } finally {
    db.close();
  }
}
