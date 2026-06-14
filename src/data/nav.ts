export type NavItem = { title: string; icon: string; href: string };

export const nav: NavItem[] = [
  { title: 'Archive',   icon: 'fas fa-list-ul',    href: '/archive.html' },
  { title: 'Tags',      icon: 'fas fa-tags',       href: '/tags.html' },
  { title: 'About',     icon: 'fas fa-user',       href: '/about.html' },
  { title: 'Osara',     icon: 'far fa-dot-circle', href: 'https://osara.lhzhang.com' },
  { title: 'Gallery',   icon: 'fas fa-film',       href: 'http://foto.lhzhang.com' },
  { title: 'Subscribe', icon: 'fas fa-rss',        href: '/atom.xml' },
];

export const siteName = 'rusty shutter';
export const author = 'wayne';
