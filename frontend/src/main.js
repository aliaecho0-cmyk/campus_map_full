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

const startupIntro = mountStartupIntro();
window.startOnboarding = startOnboarding;

// Render the static map immediately. Rewards and view reports await login separately.
void ensureLogin();
start();
startupIntro
  .play()
  .then(chooseLanguage)
  .then(showEntryAnnouncement)
  .catch(() => {})
  .finally(() => {
    state.entryReady = true;
  });
