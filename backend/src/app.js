import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/authRoutes.js';
import { boothRouter } from './routes/boothRoutes.js';
import { rewardRouter } from './routes/rewardRoutes.js';
import { claimRouter } from './routes/claimRoutes.js';
import { staffRouter } from './routes/staffRoutes.js';
import { errorHandler } from './middleware/errorHandler.js';

/**
 * 创建并配置 Express 应用。
 * 全局中间件 → 各业务路由 → errorHandler（必须在所有路由之后）。
 * @returns {import('express').Express}
 */
export function createApp() {
  const app = express();

  // CORS：允许前端（http://localhost:5173）跨域访问。必须在所有路由之前。
  app.use(cors());

  // 解析 JSON 请求体
  app.use(express.json());

  // 请求日志：响应完成时打点，记录状态码 + 耗时，便于运维从日志直接看出错误与慢请求
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });

  // 业务路由（./api/me 下同时挂 reward 与 claim，路径互不冲突）
  app.use('/api/auth', authRouter);
  app.use('/api/events', boothRouter);
  app.use('/api/me', rewardRouter);
  app.use('/api/me', claimRouter);
  app.use('/api/staff', staffRouter);

  // 统一错误处理，必须放在所有路由之后
  app.use(errorHandler);

  return app;
}

export default createApp;