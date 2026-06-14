import PhotoSwipeLightbox from 'https://cdnjs.cloudflare.com/ajax/libs/photoswipe/5.4.4/photoswipe-lightbox.esm.min.js';
import PhotoSwipe from 'https://cdnjs.cloudflare.com/ajax/libs/photoswipe/5.4.4/photoswipe.esm.min.js';

const root = document.querySelector('article .post');
if (root) {
  const images = root.querySelectorAll('img');
  if (images.length) {
    images.forEach(img => {
      if (img.closest('a')) return;
      const a = document.createElement('a');
      a.href = img.currentSrc || img.src;
      a.setAttribute('data-pswp-src', img.currentSrc || img.src);
      a.target = '_blank';
      a.rel = 'noopener';
      const setSize = () => {
        if (img.naturalWidth && img.naturalHeight) {
          a.setAttribute('data-pswp-width', img.naturalWidth);
          a.setAttribute('data-pswp-height', img.naturalHeight);
        }
      };
      if (img.complete) setSize();
      else img.addEventListener('load', setSize, { once: true });
      img.parentNode.insertBefore(a, img);
      a.appendChild(img);
    });

    const lightbox = new PhotoSwipeLightbox({
      gallery: 'article .post',
      children: 'a[data-pswp-src]',
      pswpModule: PhotoSwipe,
      showHideAnimationType: 'fade',
    });
    lightbox.init();
  }
}
