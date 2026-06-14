export interface NavItem { title: string; icon: string; href: string }

export const nav: NavItem[] = [
  { title: 'Archive', icon: 'fas fa-list-ul', href: '/archive' },
  { title: 'Tags',    icon: 'fas fa-tags',    href: '/tags' },
  { title: 'About',   icon: 'fas fa-user',    href: '/about' },
];

export const defaultSiteName = 'riovv';
export const defaultAuthor = 'Rio';
