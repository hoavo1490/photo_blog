import { JustifiedGrid } from '@egjs/grid';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';

export function initGallery(): void {
  const container = document.getElementById('album-grid');
  if (!container) return;
  if (container.dataset.galleryInited === '1') return;
  container.dataset.galleryInited = '1';

  const grid = new JustifiedGrid(container, {
    gap: 8,
    columnRange: [1, 4],
    sizeRange: [200, Infinity],
    useResizeObserver: true,
    observeChildren: false,
  });
  grid.renderItems();

  const lightbox = new PhotoSwipeLightbox({
    gallery: '#album-grid',
    children: 'a[data-pswp-src]',
    pswpModule: PhotoSwipe,
    showHideAnimationType: 'fade',
    bgOpacity: 1,
  });
  lightbox.init();
}

// Auto-init on load and Astro view transitions
initGallery();
document.addEventListener('astro:page-load', initGallery);
