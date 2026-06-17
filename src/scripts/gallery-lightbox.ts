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
      gap: 8,
      columnRange: [1, 4],
      sizeRange: [200, Infinity],
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
