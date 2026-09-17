import './styles/app.css';
import './styles/motion.css';
import { start, refresh, startOnboarding } from './router.js';
import { mountStartupIntro } from './components/startup-intro.js';
import { wx } from './adapter/wx.js';
import * as announcementService from './services/announcement.js';
import { localizeAnnouncement, setLanguage, t } from './i18n.js';
import { state } from './state.js';
import { startBackgroundMusic } from './services/background-music.js';
import { ensureLogin } from './services/auth.js';

async function chooseLanguage() {
  const result = await wx.showModal({
    title: '选择语言 / Choose Language',
    content: '请选择界面语言\nPlease select a language',
    confirmText: '中文',
    cancelText: 'English',
    maskClosable: false,
    success: () => startBackgroundMusic(),
  });
  setLanguage(result.confirm ? 'zh' : 'en');
  refresh();
}

async function showEntryAnnouncement() {
  const { list } = await announcementService.getAnnouncements();
  const announcement = list[0] ? localizeAnnouncement(list[0]) : null;
  if (!announcement) return;

  await wx.showModal({
    title: announcement.title,
    content: announcement.content,
    showCancel: false,
    confirmText: t('acknowledge'),
  });
}

export async function startApp({ setProgress, finish }) {
  const startupIntro = mountStartupIntro();
  window.startOnboarding = startOnboarding;

  const page = start();
  setProgress(65);

  // Login and first-screen assets start only after the entry loader has painted.
  let completed = 0;
  const track = (promise) => Promise.resolve(promise).then(
    () => { setProgress(65 + ++completed * 10); },
    () => { setProgress(65 + ++completed * 10); },
  );
  const ready = Promise.all([
    track(startupIntro.ready()),
    track(page?.ready),
    track(ensureLogin()),
  ]);
  let timeout;
  await Promise.race([
    ready,
    new Promise((resolve) => { timeout = setTimeout(resolve, 10000); }),
  ]);
  clearTimeout(timeout);
  await finish();

  startupIntro
    .play()
    .then(chooseLanguage)
    .then(showEntryAnnouncement)
    .catch(() => {})
    .finally(() => {
      state.entryReady = true;
    });
}
