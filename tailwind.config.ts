import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: '2rem',
			screens: {
				'2xl': '1400px'
			}
		},
		screens: {
			'xs': '480px',
			'sm': '640px',
			'md': '768px',
			'lg': '1024px',
			'xl': '1280px',
			'2xl': '1536px',
		},
		extend: {
			colors: {
				border: 'hsl(var(--border))',
				input: 'hsl(var(--input))',
				ring: 'hsl(var(--ring))',
				background: 'hsl(var(--background))',
				foreground: 'hsl(var(--foreground))',
				primary: {
					DEFAULT: 'hsl(var(--primary))',
					foreground: 'hsl(var(--primary-foreground))'
				},
				secondary: {
					DEFAULT: 'hsl(var(--secondary))',
					foreground: 'hsl(var(--secondary-foreground))'
				},
				destructive: {
					DEFAULT: 'hsl(var(--destructive))',
					foreground: 'hsl(var(--destructive-foreground))'
				},
				muted: {
					DEFAULT: 'hsl(var(--muted))',
					foreground: 'hsl(var(--muted-foreground))'
				},
				accent: {
					DEFAULT: 'hsl(var(--accent))',
					foreground: 'hsl(var(--accent-foreground))'
				},
				popover: {
					DEFAULT: 'hsl(var(--popover))',
					foreground: 'hsl(var(--popover-foreground))'
				},
				card: {
					DEFAULT: 'hsl(var(--card))',
					foreground: 'hsl(var(--card-foreground))'
				},
				sidebar: {
					DEFAULT: 'hsl(var(--sidebar-background))',
					foreground: 'hsl(var(--sidebar-foreground))',
					primary: 'hsl(var(--sidebar-primary))',
					'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
					accent: 'hsl(var(--sidebar-accent))',
					'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
					border: 'hsl(var(--sidebar-border))',
					ring: 'hsl(var(--sidebar-ring))'
				},
				'brand': {
					50: '#f5f3ff',
					100: '#ede9fe',
					200: '#ddd6fe',
					300: '#c4b5fd',
					400: '#a78bfa',
					500: '#372afc',
					600: '#2d22ca',
					700: '#241b98',
					800: '#1b1466',
					900: '#120d34',
					950: '#0a0620',
				}
			},
			borderRadius: {
				lg: 'var(--radius)',
				md: 'calc(var(--radius) - 2px)',
				sm: 'calc(var(--radius) - 4px)'
			},
			keyframes: {
				'accordion-down': {
					from: {
						height: '0'
					},
					to: {
						height: 'var(--radix-accordion-content-height)'
					}
				},
				'accordion-up': {
					from: {
						height: 'var(--radix-accordion-content-height)'
					},
					to: {
						height: '0'
					}
				},
				"fade-in": {
					"0%": {
						opacity: "0",
						transform: "translateY(20px) scale(0.95)"
					},
					"100%": {
						opacity: "1",
						transform: "translateY(0) scale(1)"
					}
				},
				"fade-in-up": {
					"0%": {
						opacity: "0",
						transform: "translateY(30px)"
					},
					"100%": {
						opacity: "1",
						transform: "translateY(0)"
					}
				},
				"scale-in": {
					"0%": {
						opacity: "0",
						transform: "scale(0.9)"
					},
					"100%": {
						opacity: "1",
						transform: "scale(1)"
					}
				},
				"slide-in-right": {
					"0%": {
						opacity: "0",
						transform: "translateX(20px)"
					},
					"100%": {
						opacity: "1",
						transform: "translateX(0)"
					}
				},
				"glow": {
					"0%, 100%": {
						boxShadow: "0 0 5px hsl(var(--primary))"
					},
					"50%": {
						boxShadow: "0 0 20px hsl(var(--primary)), 0 0 30px hsl(var(--primary))"
					}
				},
				"float": {
					"0%, 100%": {
						transform: "translateY(0px)"
					},
					"50%": {
						transform: "translateY(-10px)"
					}
				}
			},
			animation: {
				'accordion-down': 'accordion-down 0.2s ease-out',
				'accordion-up': 'accordion-up 0.2s ease-out',
				"fade-in": "fade-in 0.6s ease-out",
				"fade-in-up": "fade-in-up 0.5s ease-out",
				"scale-in": "scale-in 0.3s ease-out",
				"slide-in-right": "slide-in-right 0.4s ease-out",
				"glow": "glow 2s ease-in-out infinite",
				"float": "float 3s ease-in-out infinite",
			}
		}
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
