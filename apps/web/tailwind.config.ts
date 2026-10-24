import type {Config} from 'tailwindcss';
export default {content: ['./src/**/*.{ts,tsx}'], theme: {extend: {
  colors: {background: 'var(--bg)', surface: 'var(--s1)', raised: 'var(--s2)', hover: 'var(--s3)', foreground: 'var(--tx)', secondary: 'var(--tx2)', muted: 'var(--tx3)', positive: 'var(--pos)', negative: 'var(--neg)', warning: 'var(--warn)', accent: 'var(--ac)', cyan: 'var(--ac2)', ink: 'var(--acink)', border: 'var(--bd)'},
  borderRadius: {marketing: 'var(--marketing-radius)', app: 'var(--app-radius)'}, fontFamily: {display: ['var(--font-display)'], body: ['var(--font-body)']}
}}, plugins: []} satisfies Config;
