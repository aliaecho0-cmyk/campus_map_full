/**
 * data/logo-map.js — 社团 Logo 映射
 *
 * 图片源：项目根目录 社团logo合集/，命名 {序号}{社团名}.{扩展名}（序号与摊位号 num 无关，
 * 按名称匹配）。import.meta.glob 在构建期把图片打进 dist/assets/（带 hash），
 * 值即浏览器可用的图片 URL。
 *
 * 文件名规范化：去扩展名 → 去前导序号与空格 → 转小写、去空格与引号、×→x → 去尾部 "logo"。
 * getClubLogo(name)：别名表 → 规范化直查 → ±"社" 变体，均未命中返回 ''（沿用首字占位）。
 */
const logoFiles = import.meta.glob('../../社团logo合集/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG}', {
  eager: true,
  import: 'default',
});

function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/×/g, 'x')
    .replace(/[\s'"“”‘’]/g, '');
}

/** 规范文件名 → 图片 URL（64 张） */
const byKey = {};
for (const [path, url] of Object.entries(logoFiles)) {
  const base = path.split('/').pop().replace(/\.[^.]+$/, ''); // 去目录与扩展名
  const key = norm(base).replace(/^\d+/, '').replace(/logo$/, ''); // 去前导序号、去尾部 logo
  if (!byKey[key]) byKey[key] = url;
}

/** 名称与文件名对不上的社团：社团名 → 规范化后的文件名（人工确认） */
const ALIASES = {
  'CP食研社': '食研社', // 文件 1食研社.webp
  'CP 食研社': '食研社',
  'English Animation 英语动画社': 'English Animator', // 13English Animator.webp（Animator≠Animation）
  'Lg足球社': '足球', // 33足球.webp
  '2Tired骑行社': '骑行', // 43骑行.webp
  'V8橄榄球俱乐部': 'V8橄榄球', // 42V8橄榄球.webp
};

const used = new Set(); // dev 自检：核对是否有文件未被任何社团使用

/** 查社团名对应的 logo URL；无图返回 ''（渲染端保持首字占位） */
export function getClubLogo(name) {
  const alias = ALIASES[name];
  if (alias) {
    const key = norm(alias); // 别名值为可读写法，查表前规范化（同文件名流程）
    if (byKey[key]) {
      used.add(key);
      return byKey[key];
    }
  }
  const n = norm(name);
  for (const cand of [n, n.replace(/社$/, ''), n + '社']) {
    if (byKey[cand]) {
      used.add(cand);
      return byKey[cand];
    }
  }
  return '';
}

if (import.meta.env.DEV) {
  setTimeout(() => {
    const unused = Object.keys(byKey).filter((k) => !used.has(k));
    if (unused.length) console.warn('[logo-map] 未被任何社团使用的 logo 文件（规范化后）:', unused);
  }, 500);
}
