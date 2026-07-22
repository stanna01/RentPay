/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Instrument Sans"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Core neutrals from the RentReceipt Mobile design
        ink: '#1B2A24',
        muted: '#6B7A72',
        line: '#E5E8E3',
        surface: '#F6F7F4', // app screen background
        canvas: '#E7EAE5', // deep page background
        brand: {
          DEFAULT: '#0E6B4A',
          dark: '#0A573C',
          light: '#EAF4EF',
          soft: '#E9F6EF',
        },
        // Status palettes
        paid: { text: '#0A573C', bg: '#E9F6EF', border: '#BFE0CE', dot: '#1E9E68' },
        partial: { text: '#8A6410', bg: '#FDF6E5', border: '#EFD9A6', dot: '#E3A320' },
        due: { text: '#B3402C', bg: '#FBEEEA', border: '#EFC3B8', dot: '#D25B43' },
        vacant: { text: '#9AA69F', bg: '#F3F5F2', border: '#C4CBC4', dot: '#C4CBC4' },
      },
      boxShadow: {
        fab: '0 6px 18px rgba(14,107,74,0.35)',
        cta: '0 4px 12px rgba(14,107,74,0.30)',
        paper: '0 6px 20px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
};
