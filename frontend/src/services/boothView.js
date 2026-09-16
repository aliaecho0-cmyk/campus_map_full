import { recordBoothView } from './api.js';
import { requireLogin } from './auth.js';
import { showToast } from '../utils/toast.js';
import { t } from '../i18n.js';

const EVENT_ID = 1;
const REPORTED_KEY = 'reported_booths';

let reportedBooths = loadReported();
let onProgressChanged = null;

function loadReported() {
  try {
    const raw = localStorage.getItem(REPORTED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(String) : [];
  } catch {
    return [];
  }
}

function persistReported() {
  try {
    localStorage.setItem(REPORTED_KEY, JSON.stringify(reportedBooths));
  } catch {}
}

export function getReportedBooths() {
  return reportedBooths.slice();
}

export function hasReported(boothId) {
  return reportedBooths.indexOf(String(boothId)) !== -1;
}

export function addReportedBooth(boothId) {
  const id = String(boothId);
  if (reportedBooths.indexOf(id) === -1) reportedBooths.push(id);
  persistReported();
}

export function setOnProgressChanged(fn) {
  onProgressChanged = typeof fn === 'function' ? fn : null;
}

export function startViewSession(boothId, delayMs = 3000) {
  const id = String(boothId);
  let elapsedMs = 0;
  let startedAt = 0;
  let timer = null;
  let phase = 'paused';
  let visible = false;
  let cancelled = false;
  let successData = null;
  let successDelivered = false;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function deliverSuccess() {
    if (cancelled || !visible || !successData || successDelivered) return;
    successDelivered = true;
    const count = successData.uniqueBoothCount || 0;
    const badge = (successData.badges || []).find((b) => b.code === 'knowitall');
    const required = (badge && badge.requiredUniqueBooths) || 0;
    if (badge && count === required) showToast(t('collectComplete'));
    else if (count < required) showToast(t('collectPlusOne'));
    if (onProgressChanged) onProgressChanged(successData);
  }

  async function report() {
    phase = 'reporting';
    try {
      await requireLogin();
      const data = await recordBoothView(EVENT_ID, id);
      addReportedBooth(id);
      successData = data;
      phase = 'succeeded';
      deliverSuccess();
    } catch (e) {
      phase = 'failed';
      console.warn('[boothView] 上报失败', id, e);
    }
  }

  function resume() {
    if (cancelled || phase === 'failed' || phase === 'succeeded') {
      if (phase === 'succeeded') {
        visible = true;
        deliverSuccess();
      }
      return;
    }

    visible = true;
    if (hasReported(id)) {
      phase = 'succeeded';
      return;
    }
    if (phase === 'reporting' || phase === 'running') return;

    const remainingMs = Math.max(0, delayMs - elapsedMs);
    phase = 'running';
    startedAt = performance.now();
    timer = setTimeout(() => {
      timer = null;
      if (cancelled || phase !== 'running') return;
      elapsedMs = delayMs;
      report();
    }, remainingMs);
  }

  function pause() {
    visible = false;
    if (phase !== 'running') return;
    elapsedMs = Math.min(delayMs, elapsedMs + performance.now() - startedAt);
    clearTimer();
    phase = 'paused';
  }

  function cancel() {
    cancelled = true;
    visible = false;
    clearTimer();
    phase = 'cancelled';
  }

  return { pause, resume, cancel };
}
