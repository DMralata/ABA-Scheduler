import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        /* Backwards-compatible aliases (existing components consume these) */
        background:      "var(--background)",
        surface:         "var(--surface)",
        "surface-alt":   "var(--surface-alt)",
        "surface-muted": "var(--surface-muted)",

        foreground:      "var(--foreground)",
        "text-muted":    "var(--text-muted)",
        "text-subtle":   "var(--text-subtle)",

        border:          "var(--border)",
        "border-strong": "var(--border-strong)",
        input:           "var(--input)",
        ring:            "var(--ring)",

        good:            "var(--good)",
        "good-soft":     "var(--good-soft)",
        danger:          "var(--danger)",
        "danger-soft":   "var(--danger-soft)",
        proposed:        "var(--proposed)",
        "proposed-soft": "var(--proposed-soft)",

        /* shadcn semantic tokens */
        card: {
          DEFAULT:    "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT:    "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT:    "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT:    "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT:    "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT:    "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT:    "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },

        /* All Together Autism palette */
        ata: {
          blue: {
            25:  "var(--ata-blue-25)",
            50:  "var(--ata-blue-50)",
            100: "var(--ata-blue-100)",
            200: "var(--ata-blue-200)",
            300: "var(--ata-blue-300)",
            400: "var(--ata-blue-400)",
            500: "var(--ata-blue-500)",
            600: "var(--ata-blue-600)",
            700: "var(--ata-blue-700)",
            800: "var(--ata-blue-800)",
            900: "var(--ata-blue-900)",
          },
          navy: {
            800: "var(--ata-navy-800)",
            850: "var(--ata-navy-850)",
            900: "var(--ata-navy-900)",
            950: "var(--ata-navy-950)",
          },
          gray: {
            25:  "var(--ata-gray-25)",
            50:  "var(--ata-gray-50)",
            100: "var(--ata-gray-100)",
            200: "var(--ata-gray-200)",
            300: "var(--ata-gray-300)",
            400: "var(--ata-gray-400)",
            500: "var(--ata-gray-500)",
            600: "var(--ata-gray-600)",
            700: "var(--ata-gray-700)",
            800: "var(--ata-gray-800)",
            900: "var(--ata-gray-900)",
          },
          success: {
            50:  "var(--ata-success-50)",
            100: "var(--ata-success-100)",
            500: "var(--ata-success-500)",
            600: "var(--ata-success-600)",
            700: "var(--ata-success-700)",
          },
          warning: {
            50:  "var(--ata-warning-50)",
            100: "var(--ata-warning-100)",
            400: "var(--ata-warning-400)",
            500: "var(--ata-warning-500)",
            600: "var(--ata-warning-600)",
          },
          danger: {
            50:  "var(--ata-danger-50)",
            100: "var(--ata-danger-100)",
            300: "var(--ata-danger-300)",
            500: "var(--ata-danger-500)",
            600: "var(--ata-danger-600)",
            700: "var(--ata-danger-700)",
          },
          purple: {
            50:  "var(--ata-purple-50)",
            100: "var(--ata-purple-100)",
            500: "var(--ata-purple-500)",
            600: "var(--ata-purple-600)",
          },
          cyan: {
            50:  "var(--ata-cyan-50)",
            100: "var(--ata-cyan-100)",
            500: "var(--ata-cyan-500)",
            600: "var(--ata-cyan-600)",
          },
          teal: {
            50:  "var(--ata-teal-50)",
            100: "var(--ata-teal-100)",
            500: "var(--ata-teal-500)",
            600: "var(--ata-teal-600)",
          },
          bg:           "var(--ata-bg)",
          surface:      "var(--ata-surface)",
          "surface-muted": "var(--ata-surface-muted)",
        },
      },
      borderRadius: {
        xs:   "var(--radius-xs)",
        sm:   "var(--radius-sm)",
        md:   "var(--radius-md)",
        lg:   "var(--radius-lg)",
        xl:   "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        full: "9999px",
      },
      boxShadow: {
        xs:    "var(--shadow-xs)",
        sm:    "var(--shadow-sm)",
        md:    "var(--shadow-md)",
        lg:    "var(--shadow-lg)",
        modal: "var(--shadow-modal)",
        dock:  "var(--shadow-dock)",
      },
    },
  },
  plugins: [],
};

export default config;
