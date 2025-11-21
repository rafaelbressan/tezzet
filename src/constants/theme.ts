export const lightTheme = {
  mode: 'light' as const,
  colors: {
    primary: '#0D61FF',
    background: '#ffffff',
    surface: '#f5f5f5',
    card: '#ffffff',
    text: '#333333',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#e0e0e0',
    error: '#e74c3c',
    success: '#27ae60',
    warning: '#fef5f5',
    inputBackground: '#f5f5f5',
    headerBackground: '#0D61FF',
    headerText: '#ffffff',
  },
};

export const darkTheme = {
  mode: 'dark' as const,
  colors: {
    primary: '#4A90FF',
    background: '#121212',
    surface: '#1E1E1E',
    card: '#2A2A2A',
    text: '#FFFFFF',
    textSecondary: '#B0B0B0',
    textMuted: '#808080',
    border: '#3A3A3A',
    error: '#FF6B6B',
    success: '#4ADE80',
    warning: '#2A2020',
    inputBackground: '#2A2A2A',
    headerBackground: '#1E1E1E',
    headerText: '#FFFFFF',
  },
};

export type Theme = typeof lightTheme | typeof darkTheme;
export type ThemeMode = 'light' | 'dark' | 'system';
