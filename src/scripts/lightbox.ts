import PhotoSwipeLightbox from 'photoswipe/lightbox';
import 'photoswipe/style.css';

const root = document.querySelector<HTMLElement>('article .post');
if (root) {
  const images = root.querySelectorAll<HTMLImageElement>('img');
  if (images.length) {
    images.forEach((img) => {
      if (img.closest('a')) return;
      const a = document.createElement('a');
      const src = img.currentSrc || img.src;
      a.href = src;
      a.setAttribute('data-pswp-src', src);
      a.target = '_blank';
      a.rel = 'noopener';

      const setSize = () => {
        if (img.naturalWidth && img.naturalHeight) {
          a.setAttribute('data-pswp-width', String(img.naturalWidth));
          a.setAttribute('data-pswp-height', String(img.naturalHeight));
        }
      };
      if (img.complete) setSize();
      else img.addEventListener('load', setSize, { once: true });

      img.parentNode?.insertBefore(a, img);
      a.appendChild(img);
    });

    const lightbox = new PhotoSwipeLightbox({
      gallery: 'article .post',
      children: 'a[data-pswp-src]',
      pswpModule: () => import('photoswipe'),
      showHideAnimationType: 'fade',
    });
    lightbox.init();
  }
}
