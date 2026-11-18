/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: ['./src/**/*.{js,ts,jsx,tsx}'],
    theme: {
        extend: {
            colors: {
                // Background colors
                'bg-primary': 'rgb(var(--bg-primary) / <alpha-value>)',
                'bg-secondary': 'rgb(var(--bg-secondary) / <alpha-value>)',
                'bg-tertiary': 'rgb(var(--bg-tertiary) / <alpha-value>)',

                // Border colors
                'border-primary': 'rgb(var(--border-primary) / <alpha-value>)',
                'border-secondary': 'rgb(var(--border-secondary) / <alpha-value>)',

                // Accent colors
                accent: 'rgb(var(--accent) / <alpha-value>)',
                'accent-hover': 'rgb(var(--accent-hover) / <alpha-value>)',

                // Text colors
                'text-primary': 'rgb(var(--text-primary) / <alpha-value>)',
                'text-secondary': 'rgb(var(--text-secondary) / <alpha-value>)',
                'text-muted': 'rgb(var(--text-muted) / <alpha-value>)',

                // Status colors
                'status-draft': 'rgb(var(--status-draft) / <alpha-value>)',
                'status-posted': 'rgb(var(--status-posted) / <alpha-value>)',

                // X-Native Primary CTA Pill Colors
                'cta-bg': 'rgb(var(--cta-bg) / <alpha-value>)',
                'cta-text': 'rgb(var(--cta-text) / <alpha-value>)',
                'cta-hover': 'rgb(var(--cta-hover) / <alpha-value>)',
            },
            fontFamily: {
                sans: [
                    '-apple-system',
                    'BlinkMacSystemFont',
                    '"Segoe UI"',
                    'Roboto',
                    '"PingFang SC"',
                    '"Hiragino Sans GB"',
                    '"Microsoft YaHei"',
                    'sans-serif',
                ],
            },
        },
    },
    plugins: [],
};
