import PhotoSwipeLightbox from 'photoswipe/lightbox';
import PhotoSwipe from 'photoswipe';
import 'photoswipe/style.css';

type StreamItem = { src: string; href: string; title: string };

const root = document.querySelector<HTMLElement>('article .post');
const streamEl = document.querySelector<HTMLScriptElement>('#lightbox-stream');
const stream: StreamItem[] = streamEl ? JSON.parse(streamEl.textContent || '[]') : [];

if (root && stream.length) {
  // PhotoSwipe needs intrinsic dimensions per slide. We don't know them at
  // build time, so we mark each item lazy and let PhotoSwipe sniff width/height
  // when each slide loads. (The dataSource accepts a function via getNumItems
  // and itemData hooks; we cache dimensions as we discover them.)
  const dims = new Map<string, { w: number; h: number }>();

  function probe(src: string): Promise<{ w: number; h: number }> {
    return new Promise((resolve) => {
      const cached = dims.get(src);
      if (cached) return resolve(cached);
      const img = new Image();
      img.onload = () => {
        const v = { w: img.naturalWidth || 1600, h: img.naturalHeight || 1200 };
        dims.set(src, v);
        resolve(v);
      };
      img.onerror = () => resolve({ w: 1600, h: 1200 });
      img.src = src;
    });
  }

  const lightbox = new PhotoSwipeLightbox({
    dataSource: stream.map((s) => ({
      src: s.src,
      width: dims.get(s.src)?.w ?? 1600,
      height: dims.get(s.src)?.h ?? 1200,
      alt: s.title,
    })),
    pswpModule: PhotoSwipe,
    showHideAnimationType: 'fade',
    loop: false,
  });

  // Refine dimensions when each slide is shown so zoom-to-fit is accurate.
  lightbox.on('contentLoad', async ({ content }) => {
    if (!content?.data?.src) return;
    const real = await probe(content.data.src);
    content.data.width = real.w;
    content.data.height = real.h;
  });

  // Add a caption with the post title (also acts as a link back to the post).
  lightbox.on('uiRegister', () => {
    lightbox.pswp?.ui?.registerElement({
      name: 'caption',
      order: 9,
      isButton: false,
      appendTo: 'root',
      html: '',
      onInit: (el) => {
        el.className = 'pswp-caption';
        lightbox.pswp?.on('change', () => {
          const idx = lightbox.pswp?.currIndex ?? 0;
          const item = stream[idx];
          if (!item) return;
          el.innerHTML = `<a href="${item.href}">${escapeHtml(item.title)}</a>`;
        });
      },
    });
  });

  // Wire each image in the post body to open the lightbox at its stream index.
  const images = root.querySelectorAll<HTMLImageElement>('img');
  images.forEach((img) => {
    const src = img.currentSrc || img.src;
    let a = img.closest<HTMLAnchorElement>('a');
    if (a) {
      a.removeAttribute('target');
      a.href = src;
    } else {
      a = document.createElement('a');
      a.href = src;
      img.parentNode?.insertBefore(a, img);
      a.appendChild(img);
    }
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const idx = stream.findIndex((s) => s.src === src);
      lightbox.loadAndOpen(idx >= 0 ? idx : 0);
    });
  });

  lightbox.init();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}
