const loading = document.getElementById('entry-loading');
const image = document.getElementById('entry-console');
const progressBar = loading.querySelector('.entry-progress');
const progressFill = loading.querySelector('.entry-progress-fill');
const percent = loading.querySelector('.entry-percent');
let progress = 0;

function setProgress(value) {
  progress = Math.max(progress, Math.min(100, Math.round(value)));
  progressFill.style.width = `${progress}%`;
  progressBar.setAttribute('aria-valuenow', String(progress));
  percent.textContent = `${progress}%`;
  loading.setAttribute('aria-label', `Loading... ${progress}%`);
}

function waitForImage() {
  if (image.complete) return Promise.resolve();
  return Promise.race([
    new Promise((resolve) => {
      image.addEventListener('load', resolve, { once: true });
      image.addEventListener('error', resolve, { once: true });
    }),
    new Promise((resolve) => setTimeout(resolve, 2500)),
  ]);
}

async function finish() {
  setProgress(100);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  loading.classList.add('is-leaving');
  await new Promise((resolve) => setTimeout(resolve, 180));
  loading.remove();
}

async function boot() {
  await waitForImage();
  setProgress(10);
  // Give the lightweight loading screen a painted frame before fetching the app bundle.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  try {
    const { startApp } = await import('./main.js');
    setProgress(35);
    await startApp({ setProgress, finish });
  } catch (error) {
    console.error('[entry] 启动失败', error);
    loading.classList.add('has-error');
    loading.querySelector('.entry-label').textContent = '加载失败';
  }
}

void boot();
