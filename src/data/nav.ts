export interface NavItem { title: string; icon: string; href: string }

export const nav: NavItem[] = [
  { title: 'Archive', icon: 'archive', href: '/archive' },
  { title: 'Topics',  icon: 'topics',  href: '/topics' },
  { title: 'Tags',    icon: 'tags',    href: '/tags' },
  { title: 'Gallery', icon: 'gallery', href: '/gallery' },
  { title: 'About',   icon: 'user',    href: '/about' },
];

export const defaultSiteName = 'hoavv';
export const defaultAuthor = 'Rio';
