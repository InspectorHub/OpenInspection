/** @type {import('tailwindcss').Config} */
export default {
    content: ['./src/**/*.{ts,tsx,html}'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                serif: ['Playfair Display', 'serif'],
                display: ['"Bricolage Grotesque"', 'system-ui'],
                body: ['"DM Sans"', 'system-ui'],
                mono: ['"JetBrains Mono"', 'monospace'],
            },
            colors: {
                surface: { 50: '#faf9f7', 100: '#f3f1ed', 200: '#e8e4dd' },
                ink: { 900: '#1a1815', 800: '#2d2a26', 700: '#46423c', 600: '#6b6560', 500: '#908a83', 400: '#b0aaa3', 300: '#d0cbc4' },
                blueprint: { 50: '#eef4ff', 100: '#d9e5ff', 200: '#bcd2ff', 500: '#4a72ff', 600: '#3355e0', 700: '#2640b8' },
            },
            borderRadius: { '4xl': '2rem', '5xl': '2.5rem' },
            animation: {
                'fade-in': 'fadeIn 0.4s ease-out',
                'slide-up': 'slideUp 0.35s ease-out',
                'scale-in': 'scaleIn 0.25s ease-out',
            },
            keyframes: {
                fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
                slideUp: { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
                scaleIn: { '0%': { opacity: '0', transform: 'scale(0.95)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
            },
        },
    },
    plugins: [],
};
