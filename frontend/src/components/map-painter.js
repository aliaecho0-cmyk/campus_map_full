/** 参考模板底图。图片自身按 30×30 语义格绘制，交互仍使用原地图坐标。 */
import mapZhSrc from '../../地图相关素材/地图参考模板.webp';
import mapEnSrc from '../../地图相关素材/地图参考模板2.webp';
import { isEnglish } from '../i18n.js';

export const MAP_IMAGE_WIDTH = 1264;
export const MAP_IMAGE_HEIGHT = 1244;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`地图模板加载失败: ${src}`));
    image.src = src;
  });
}

export async function createMapPainter() {
  // 中英两张图各自兜底加载；单张失败不整体 reject，用已加载的一张画
  const [zh, en] = await Promise.all([
    loadImage(mapZhSrc).catch(() => null),
    loadImage(mapEnSrc).catch(() => null),
  ]);
  return {
    paint(ctx) {
      const img = (isEnglish() ? en : zh) || en || zh;
      if (!img) return;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, 30, 30);
      ctx.restore();
    },
  };
}