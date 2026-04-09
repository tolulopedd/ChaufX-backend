export const tokens = {
  color: {
    brand: {
      50: "#eef3ff",
      100: "#dce6ff",
      200: "#bfd2ff",
      300: "#94b5ff",
      400: "#5c8eff",
      500: "#2f6bff",
      600: "#204bdb",
      700: "#1636ab",
      800: "#152d86",
      900: "#142765"
    },
    accent: "#10b981",
    surface: "#ffffff",
    surfaceMuted: "#f5f8ff",
    ink: "#081120",
    muted: "#64748b",
    border: "#d8e0f2",
    warning: "#f59e0b",
    danger: "#dc2626"
  },
  radius: {
    sm: 10,
    md: 16,
    lg: 22,
    xl: 30
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32
  },
  typography: {
    family: {
      sans: "\"Avenir Next\", Inter, \"Segoe UI\", sans-serif"
    }
  }
} as const;

export type DesignTokens = typeof tokens;
