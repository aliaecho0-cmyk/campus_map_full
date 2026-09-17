// 统一错误处理：把 Route/中间件通过 next(err) 抛来的错误码转成 API 契约格式的 HTTP 响应
// 错误码与状态映射见 docs/api.md §1.4 / BACKEND_PLAN §12

export const HTTP_STATUS_BY_CODE = {
  INVALID_REQUEST: 400,
  AUTH_REQUIRED: 401,
  INVALID_TOKEN: 401,
  STAFF_REQUIRED: 403,
  BADGE_NOT_UNLOCKED: 403,
  EVENT_NOT_FOUND: 404,
  CLAIM_TOKEN_NOT_FOUND: 404,
  EVENT_NOT_ACTIVE: 409,
  CLAIM_TOKEN_EXPIRED: 409,
  CLAIM_TOKEN_REDEEMED: 409,
  PAYLOAD_TOO_LARGE: 413,
  SQLITE_BUSY: 503,
};

export const CODE_MESSAGE = {
  INVALID_REQUEST: '请求参数错误',
  AUTH_REQUIRED: '未登录，请携带 JWT',
  INVALID_TOKEN: 'JWT 无效或已过期',
  STAFF_REQUIRED: '需要工作人员权限',
  BADGE_NOT_UNLOCKED: '未解锁 knowitall，无法操作',
  EVENT_NOT_FOUND: '活动不存在',
  CLAIM_TOKEN_NOT_FOUND: '领取码不存在',
  EVENT_NOT_ACTIVE: '活动当前不可用',
  CLAIM_TOKEN_EXPIRED: '已超过活动截止时间',
  CLAIM_TOKEN_REDEEMED: '领取码已经核销',
  PAYLOAD_TOO_LARGE: '请求体过大',
  SQLITE_BUSY: '数据库繁忙，请稍后重试',
  INTERNAL_SERVER_ERROR: '服务器内部错误',
};

/**
 * 取错误码对应的 HTTP 状态码。
 * @param {string} code
 * @returns {number | undefined} 未注册的错误码返回 undefined
 */
export function statusForCode(code) {
  return HTTP_STATUS_BY_CODE[code];
}

/**
 * 判断是否为 SQLite 忙类错误（写锁竞争 / 快照冲突），这类错误可重试。
 * node:sqlite 抛错时 err.errcode 为 SQLite 结果码：5 = SQLITE_BUSY，517 = SQLITE_BUSY_SNAPSHOT；
 * 也可能以 message/errstr 文本形式出现（如 "database is locked"）。
 * @param {Error} err
 * @returns {boolean}
 */
export function isSqliteBusy(err) {
  if (!err) return false;
  const text = [
    typeof err.message === 'string' ? err.message : '',
    typeof err.code === 'string' ? err.code : '',
    typeof err.errstr === 'string' ? err.errstr : '',
  ].join(' ');
  if (/database (?:table )?is locked|SQLITE_BUSY/i.test(text)) return true;
  return err.errcode === 5 || err.errcode === 517;
}

/**
 * Express 错误处理中间件（四个参数，缺一不可）。
 * 错误分类优先级：
 *   1. 业务错误码：err.message 即错误码（如 AUTH_REQUIRED），按映射表取状态；
 *   2. body-parser / express.json 的请求解析错误：优先按 err.type / err.status 归类
 *      （entity.too.large → 413，entity.parse.failed 或其它 4xx status → 400），
 *      避免被 err.message 匹配逻辑误判成 500；
 *   3. 兜底：INTERNAL_SERVER_ERROR → 500。
 * 开发环境（NODE_ENV=development）额外返回 err.stack。
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV === 'development';

  const msgCode = err && typeof err.message === 'string' ? err.message : null;
  const mappedStatus = msgCode ? statusForCode(msgCode) : undefined;

  let status;
  let code;
  if (mappedStatus) {
    // 业务错误码：命中映射表则直接采用（401/403/404/409…，不受影响）
    status = mappedStatus;
    code = msgCode;
  } else if (err?.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
  } else if (err?.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_REQUEST';
  } else if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
    // 其它带 4xx status 的错误（如 strict 模式拒绝非对象 body）直接采用；5xx 不在此分支
    status = err.status;
    code = err.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST';
  } else if (isSqliteBusy(err)) {
    // 数据库忙（锁竞争/快照冲突）：可重试，映射 503 而非 500
    status = 503;
    code = 'SQLITE_BUSY';
  } else {
    status = 500;
    code = 'INTERNAL_SERVER_ERROR';
  }

  console.error(`${new Date().toISOString()} [${code}]`, err?.stack || err);
  const body = { error: { code, message: CODE_MESSAGE[code] ?? code } };
  if (isDev && err) body.error.stack = err.stack;
  res.status(status).json(body);
}

export default errorHandler;
