export type AppThemeMode = 'light' | 'dark' | 'auto';

/**
 * Convert HEX to RGB
 */
function hexToRgb(hex: string): { r: number, g: number, b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

/**
 * Mix two colors
 */
function mixColor(color1: string, color2: string, weight: number) {
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  if (!c1 || !c2) return color1;

  const r = Math.round(c1.r * (1 - weight) + c2.r * weight);
  const g = Math.round(c1.g * (1 - weight) + c2.g * weight);
  const b = Math.round(c1.b * (1 - weight) + c2.b * weight);

  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

/**
 * Applies the primary color to CSS variables (for standard use and Element Plus)
 */
export function applyPrimaryColor(color: string, isDark: boolean) {
  if (!color) return;

  const root = document.documentElement;
  
  // Set the core primary colors
  root.style.setProperty('--color-primary', color);
  root.style.setProperty('--el-color-primary', color);

  // Generate light/dark variants for Element Plus hover/active states
  const mixTarget = isDark ? '#141414' : '#ffffff';
  
  for (let i = 1; i <= 9; i++) {
    const weight = i * 0.1;
    const mixed = mixColor(color, mixTarget, weight);
    root.style.setProperty(`--el-color-primary-light-${i}`, mixed);
  }
  
  const darkTarget = isDark ? '#ffffff' : '#000000';
  root.style.setProperty('--el-color-primary-dark-2', mixColor(color, darkTarget, 0.2));
  root.style.setProperty('--color-primary-hover', mixColor(color, darkTarget, 0.2));

  // Tonal Palette Global Integration
  if (isDark) {
    // Dark mode: Use neutral Zinc base and tint very lightly (2-10%) to prevent muddy colors
    const darkBase = '#09090b'; // Zinc 950 (very deep, neutral black)
    const secondaryBase = '#18181b'; // Zinc 900
    const borderBase = '#27272a'; // Zinc 800
    
    root.style.setProperty('--bg-primary', mixColor(color, darkBase, 0.97)); // 3% tint
    root.style.setProperty('--bg-secondary', mixColor(color, secondaryBase, 0.95)); // 5% tint
    root.style.setProperty('--border-color', mixColor(color, borderBase, 0.90)); // 10% tint
    root.style.setProperty('--text-primary', '#f8fafc'); 
    root.style.setProperty('--text-secondary', mixColor(color, '#a1a1aa', 0.90)); // Zinc 400 + 10% tint
  } else {
    // Light mode: clean bright backgrounds
    const lightBase = '#ffffff';
    const borderBase = '#e4e4e7'; // Zinc 200
    root.style.setProperty('--bg-primary', mixColor(color, lightBase, 0.98)); // 2% tint
    root.style.setProperty('--bg-secondary', lightBase); // pure white cards/sidebar for contrast
    root.style.setProperty('--border-color', mixColor(color, borderBase, 0.90)); 
    root.style.setProperty('--text-primary', mixColor(color, '#18181b', 0.90)); // Zinc 900
    root.style.setProperty('--text-secondary', mixColor(color, '#71717a', 0.85)); // Zinc 500
  }
}

let mediaQueryList: MediaQueryList | null = null;
let currentAutoHandler: ((e: MediaQueryListEvent) => void) | null = null;

export function applyAppTheme(mode: AppThemeMode, primaryColor: string) {
  const root = document.documentElement;
  const isSystemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let isDark = false;

  // Cleanup old listener
  if (mediaQueryList && currentAutoHandler) {
    mediaQueryList.removeEventListener('change', currentAutoHandler);
  }

  if (mode === 'dark') {
    isDark = true;
    root.classList.add('dark');
  } else if (mode === 'light') {
    isDark = false;
    root.classList.remove('dark');
  } else {
    // auto
    isDark = isSystemDark;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Set up listener for auto mode
    mediaQueryList = window.matchMedia('(prefers-color-scheme: dark)');
    currentAutoHandler = (e: MediaQueryListEvent) => {
      const systemDark = e.matches;
      if (systemDark) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      applyPrimaryColor(primaryColor, systemDark);
    };
    mediaQueryList.addEventListener('change', currentAutoHandler);
  }

  // Apply primary color with context of current dark/light mode
  applyPrimaryColor(primaryColor, isDark);
}
