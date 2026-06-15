import PhotoSwipeLightbox from 'photoswipe/lightbox';
import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';

// Idempotent init -- callable on every page entry (including Astro's
// view-transition `astro:page-load` event). Guards against double-wrap
// when the same DOM survives a non-navigation re-call.

export function initLightbox(): void {
  const root = document.querySelector<HTMLElement>('article .post');
  if (!root) return;
  if (root.dataset.lightboxInited === '1') return;
  root.dataset.lightboxInited = '1';

  const images = root.querySelectorAll<HTMLImageElement>('img');
  if (!images.length) return;

  images.forEach((img) => {
    // Prefer the original-resolution URL set by the markdown rewriter;
    // otherwise fall back to whatever variant the browser picked.
    const fullSrc = img.dataset.pswpSrc || img.currentSrc || img.src;

    // If the img sits inside a <picture>, wrap the picture (not the
    // img) so the lightbox anchor doesn't end up as an invalid child
    // of <picture>. Otherwise wrap the img directly.
    const picture = img.parentElement?.tagName === 'PICTURE'
      ? (img.parentElement as HTMLElement)
      : null;
    const target = picture ?? img;

    let a = target.closest<HTMLAnchorElement>('a');
    if (a && a !== target.parentElement) a = null; // unrelated outer anchor
    if (a) {
      // Existing wrapper (markdown `[![alt](img)](url)`): override href
      // so click opens the lightbox.
      a.setAttribute('data-pswp-src', fullSrc);
      a.href = fullSrc;
      a.removeAttribute('target');
    } else {
      a = document.createElement('a');
      a.href = fullSrc;
      a.setAttribute('data-pswp-src', fullSrc);
      target.parentNode?.insertBefore(a, target);
      a.appendChild(target);
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
    pswpModule: PhotoSwipe,
    showHideAnimationType: 'fade',
    bgOpacity: 1,
  });
  lightbox.init();
}

// Back-compat: importing the module still triggers init on the page
// the importer was running on. This preserves behavior for any caller
// that hasn't switched to the explicit initLightbox() entry point yet.
initLightbox();
