/** @type {import('tailwindcss').Config} */
export default {
  content: ['./client/index.html', './client/src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        lagoon: {
          50: '#f1fbfb',
          100: '#d6f4f2',
          200: '#ade8e4',
          300: '#77d6d0',
          400: '#42bfb9',
          500: '#23a7a4',
          600: '#1a8686',
          700: '#186b6d',
          800: '#195557',
          900: '#184648'
        },
        ember: {
          50: '#fff4eb',
          100: '#fee5d2',
          200: '#fdc6a2',
          300: '#fba36e',
          400: '#f78443',
          500: '#f16924',
          600: '#df5418',
          700: '#b94117',
          800: '#94351a',
          900: '#782e18'
        },
        ink: '#142033',
        mist: '#f7fbfd'
      },
      boxShadow: {
        soft: '0 24px 60px rgba(20, 32, 51, 0.12)',
        glow: '0 18px 45px rgba(35, 167, 164, 0.18)'
      },
      keyframes: {
        drift: {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -14px, 0)' }
        },
        rise: {
          from: { opacity: '0', transform: 'translate3d(0, 24px, 0)' },
          to: { opacity: '1', transform: 'translate3d(0, 0, 0)' }
        }
      },
      animation: {
        drift: 'drift 10s ease-in-out infinite',
        rise: 'rise 0.5s ease-out both'
      }
    }
  },
  plugins: []
};
