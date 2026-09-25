import { JustifiedGrid } from '@egjs/grid';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';

export function initGallery(): void {
  const sections = Array.from(document.querySelectorAll<HTMLElement>('.section-images'));
  if (!sections.length) return;

  // Init a JustifiedGrid per album section (mirrors foto's per-section approach)
  sections.forEach(section => {
    if (section.dataset.galleryInited === '1') return;
    section.dataset.galleryInited = '1';
    new JustifiedGrid(section, {
      // 6px matches the gallery index. Row height is capped so a single
      // wide photo can't make a row taller than the viewport.
      gap: 6,
      columnRange: [1, 4],
      sizeRange: [180, 360],
      useResizeObserver: true,
      observeChildren: false,
    }).renderItems();
  });

  // One PhotoSwipe instance covering all sections
  if (document.body.dataset.pswpInited === '1') return;
  document.body.dataset.pswpInited = '1';
  const lightbox = new PhotoSwipeLightbox({
    gallery: '.section-images',
    children: 'a[data-pswp-src]',
    pswpModule: PhotoSwipe,
    showHideAnimationType: 'fade',
    bgOpacity: 1,
  });
  lightbox.init();
}

initGallery();
document.addEventListener('astro:page-load', () => {
  // Reset pswp flag on page transition so it re-inits for the new page
  document.body.dataset.pswpInited = '0';
  initGallery();
});
