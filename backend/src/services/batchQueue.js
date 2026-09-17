/**
 * services/batchQueue.js — 通用批写队列
 *
 * 用于"浏览摊位+1"这类高并发小写:请求只 push 数据立即返回,后台定时批量 flush,
 * 合并成单个事务写库,降低 fsync 与写放大。
 *
 * flush 策略(先到先得):定时器到点就把当前队列里的全部写入(哪怕只有 1 条);
 * 若攒满 maxBatch 则不等定时器、立即刷。
 * 失败放回队首重试,连续失败超过 maxRetries 次则丢弃该批并写日志(droppedCount 计数),
 * 避免永久坏数据(如 schema 不匹配)无限占 DB 时间;process 退出前可 flushNow 冲刷剩余。
 */
export function createBatchQueue({
  processor,
  intervalMs = 200,
  maxBatch = 100,
  maxRetries = 3,
}) {
  if (typeof processor !== 'function') throw new TypeError('processor is required');

  let queue = [];
  let timer = null;
  let flushing = false;
  let headRetries = 0; // 队首批已连续失败次数
  let dropped = 0; // 累计丢弃条数(重试超限)

  function schedule() {
    if (timer !== null || flushing) return;
    timer = setInterval(tick, intervalMs);
    // 定时器不阻止进程退出(与 flushNow 配合优雅冲刷)
    if (timer.unref) timer.unref();
  }

  function push(item) {
    queue.push(item);
    if (queue.length >= maxBatch) {
      // 攒满即刷;但避免在 CPU 热点上反复加定时器
      if (flushing) return;
      clearInterval(timer);
      timer = null;
      flush();
      return;
    }
    schedule();
  }

  /** 定时器到点:队列里有几条就写几条(哪怕只有 1 条)。 */
  function tick() {
    flush();
  }

  function flush() {
    if (flushing) return;
    if (queue.length === 0) {
      stopTimer();
      return;
    }
    flushing = true;
    // 取一批:优先取满 maxBatch,否则取全部(含只有 1 条的情况)
    const batch = queue.length > maxBatch ? queue.splice(0, maxBatch) : queue.splice(0);
    Promise.resolve()
      .then(() => processor(batch))
      .then(() => {
        headRetries = 0; // 成功,队首批已换
      })
      .catch((err) => {
        headRetries += 1;
        if (headRetries > maxRetries) {
          // 超过重试上限:丢弃并留痕(纯统计可接受,但不能无声无息)
          dropped += batch.length;
          headRetries = 0;
          console.error(`[batchQueue] 丢弃 ${batch.length} 条(重试 ${maxRetries} 次仍失败): ${err && err.message}`);
        } else {
          // 放回队首,等下次定时器重试
          queue = batch.concat(queue);
          console.error(`[batchQueue] 第 ${headRetries}/${maxRetries} 次重试失败,放回 ${batch.length} 条: ${err && err.message}`);
        }
      })
      .finally(() => {
        flushing = false;
        if (queue.length === 0) stopTimer();
        else schedule();
      });
  }

  function stopTimer() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  /** 进程退出前冲刷剩余批。sync force:即使 processor 抛错也尽力清空。 */
  function flushNow() {
    stopTimer();
    if (queue.length === 0) return;
    try {
      processor(queue);
      queue = [];
    } catch (err) {
      dropped += queue.length;
      console.error('[batchQueue] flushNow failed, dropped ' + queue.length + ' items:', err && err.message);
      queue = [];
    }
  }

  function pendingCount() {
    return queue.length;
  }

  return { push, flushNow, pendingCount, droppedCount: () => dropped };
}