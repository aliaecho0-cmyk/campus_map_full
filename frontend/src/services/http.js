/** Keep the deadline active until the response body has finished loading too. */
export async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      // Reverse proxies may return non-JSON errors. Preserve their HTTP status.
      if (response.ok && response.status !== 204) throw error;
    }
    return { response, data };
  } catch (error) {
    if (timedOut) {
      const timeout = new Error('Request timed out');
      timeout.name = 'TimeoutError';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
