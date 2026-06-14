import PhotoSwipeLightbox from 'photoswipe/lightbox';
import 'photoswipe/style.css';

const root = document.querySelector<HTMLElement>('article .post');
if (root) {
  const images = root.querySelectorAll<HTMLImageElement>('img');
  if (images.length) {
    images.forEach((img) => {
      const src = img.currentSrc || img.src;
      let a = img.closest<HTMLAnchorElement>('a');
      if (a) {
        // Image is already wrapped in <a> (e.g. markdown `[![alt](img)](url)`).
        // Override the link so click opens the lightbox instead of leaving the page.
        a.setAttribute('data-pswp-src', src);
        a.href = src;
        a.removeAttribute('target');
      } else {
        a = document.createElement('a');
        a.href = src;
        a.setAttribute('data-pswp-src', src);
        img.parentNode?.insertBefore(a, img);
        a.appendChild(img);
      }

      const setSize = () => {
        if (img.naturalWidth && img.naturalHeight) {
          a!.setAttribute('data-pswp-width', String(img.naturalWidth));
          a!.setAttribute('data-pswp-height', String(img.naturalHeight));
        }
      };
      if (img.complete) setSize();
      else img.addEventListener('load', setSize, { once: true });
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
