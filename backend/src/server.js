import { createApp } from './app.js';
import { initWAL, resolveDbPath } from './db.js';
import { startWalMonitor } from './services/walPorter.js';
import { flushViewQueue } from './services/boothViewService.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const app = createApp();

const required = ['STAFF_CODE', 'JWT_SECRET'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`缺少必需环境变量: ${key}`);
    process.exit(1);
  }
}

// WAL 模式仅启动时首个连接执行一次（文件级持久，幂等）
const journalMode = initWAL();
console.log(`SQLite journal_mode = ${journalMode}`);

// 平时 PASSIVE autocheckpoint，WAL 超阈值时主动 RESTART
const walMon = startWalMonitor({ dbPath: resolveDbPath() });

// 优雅退出：冲刷未落库的浏览统计，停检查点监控
function shutdown(signal) {
  console.log(`收到 ${signal},冲刷浏览计数队列…`);
  try {
    flushViewQueue();
  } finally {
    walMon.stop();
    process.exit(0);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

app.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});