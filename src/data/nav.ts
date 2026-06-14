export interface NavItem { title: string; icon: string; href: string }

export const nav: NavItem[] = [
  { title: 'Archive', icon: 'archive', href: '/archive' },
  { title: 'Tags',    icon: 'tags',    href: '/tags' },
  { title: 'About',   icon: 'user',    href: '/about' },
];

export const defaultSiteName = 'riovv';
export const defaultAuthor = 'Rio';
