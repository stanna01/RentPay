// Brand colours and spacing, matching the web portal (client/tailwind.config.js).

export const colors = {
  ink: '#1B2A24',
  muted: '#6B7A72',
  line: '#E5E8E3',
  surface: '#F6F7F4',
  canvas: '#E7EAE5',
  white: '#FFFFFF',
  brand: '#0E6B4A',
  brandDark: '#0A573C',
  brandLight: '#EAF4EF',
  paid: { text: '#0A573C', bg: '#E9F6EF', border: '#BFE0CE' },
  partial: { text: '#8A6410', bg: '#FDF6E5', border: '#EFD9A6' },
  due: { text: '#B3402C', bg: '#FBEEEA', border: '#EFC3B8' },
  vacant: { text: '#9AA69F', bg: '#F3F5F2', border: '#C4CBC4' },
} as const;

export const radius = { sm: 10, md: 12, lg: 16 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
