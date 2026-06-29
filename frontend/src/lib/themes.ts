export interface TerminalTheme {
  name: string;
  colors: {
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
  }
}

export const THEMES: Record<string, TerminalTheme> = {
  // ═══════════════════════════════════════════
  //  Dark Themes (11)
  // ═══════════════════════════════════════════

  'one-dark': {
    name: 'One Dark',
    colors: {
      background: '#1e1e24',
      foreground: '#abb2bf',
      cursor: '#528bff',
      cursorAccent: '#1e1e24',
      selectionBackground: 'rgba(97, 175, 239, 0.3)',
      black: '#282c34',
      red: '#e06c75',
      green: '#98c379',
      yellow: '#e5c07b',
      blue: '#61afef',
      magenta: '#c678dd',
      cyan: '#56b6c2',
      white: '#abb2bf',
      brightBlack: '#5c6370',
      brightRed: '#e06c75',
      brightGreen: '#98c379',
      brightYellow: '#e5c07b',
      brightBlue: '#61afef',
      brightMagenta: '#c678dd',
      brightCyan: '#56b6c2',
      brightWhite: '#ffffff'
    }
  },

  'dracula': {
    name: 'Dracula',
    colors: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      cursorAccent: '#282a36',
      selectionBackground: '#44475a',
      black: '#21222c',
      red: '#ff5555',
      green: '#50fa7b',
      yellow: '#f1fa8c',
      blue: '#bd93f9',
      magenta: '#ff79c6',
      cyan: '#8be9fd',
      white: '#f8f8f2',
      brightBlack: '#6272a4',
      brightRed: '#ff6e6e',
      brightGreen: '#69ff94',
      brightYellow: '#ffffa5',
      brightBlue: '#d6acff',
      brightMagenta: '#ff92df',
      brightCyan: '#a4ffff',
      brightWhite: '#ffffff'
    }
  },

  'github-dark': {
    name: 'GitHub Dark',
    colors: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#58a6ff',
      cursorAccent: '#0d1117',
      selectionBackground: 'rgba(56, 139, 253, 0.4)',
      black: '#484f58',
      red: '#ff7b72',
      green: '#3fb950',
      yellow: '#d29922',
      blue: '#58a6ff',
      magenta: '#bc8cff',
      cyan: '#39c5cf',
      white: '#b1bac4',
      brightBlack: '#6e7681',
      brightRed: '#ffa198',
      brightGreen: '#56d364',
      brightYellow: '#e3b341',
      brightBlue: '#79c0ff',
      brightMagenta: '#d2a8ff',
      brightCyan: '#56d4dd',
      brightWhite: '#ffffff'
    }
  },

  'monokai': {
    name: 'Monokai',
    colors: {
      background: '#272822',
      foreground: '#f8f8f2',
      cursor: '#f8f8f0',
      cursorAccent: '#272822',
      selectionBackground: '#49483e',
      black: '#272822',
      red: '#f92672',
      green: '#a6e22e',
      yellow: '#f4bf75',
      blue: '#66d9ef',
      magenta: '#ae81ff',
      cyan: '#a1efe4',
      white: '#f8f8f2',
      brightBlack: '#75715e',
      brightRed: '#f92672',
      brightGreen: '#a6e22e',
      brightYellow: '#f4bf75',
      brightBlue: '#66d9ef',
      brightMagenta: '#ae81ff',
      brightCyan: '#a1efe4',
      brightWhite: '#f9f8f5'
    }
  },

  // --- New dark themes from VHS themes.json ---

  'catppuccin-mocha': {
    name: 'Catppuccin Mocha',
    colors: {
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#f5e0dc',
      cursorAccent: '#1e1e2e',
      selectionBackground: '#585b70',
      black: '#45475a',
      red: '#f38ba8',
      green: '#a6e3a1',
      yellow: '#f9e2af',
      blue: '#89b4fa',
      magenta: '#f5c2e7',
      cyan: '#94e2d5',
      white: '#bac2de',
      brightBlack: '#585b70',
      brightRed: '#f38ba8',
      brightGreen: '#a6e3a1',
      brightYellow: '#f9e2af',
      brightBlue: '#89b4fa',
      brightMagenta: '#f5c2e7',
      brightCyan: '#94e2d5',
      brightWhite: '#a6adc8'
    }
  },

  'tokyo-night': {
    name: 'Tokyo Night',
    colors: {
      background: '#1a1b26',
      foreground: '#c0caf5',
      cursor: '#c0caf5',
      cursorAccent: '#1a1b26',
      selectionBackground: '#33467c',
      black: '#15161e',
      red: '#f7768e',
      green: '#9ece6a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#a9b1d6',
      brightBlack: '#414868',
      brightRed: '#f7768e',
      brightGreen: '#9ece6a',
      brightYellow: '#e0af68',
      brightBlue: '#7aa2f7',
      brightMagenta: '#bb9af7',
      brightCyan: '#7dcfff',
      brightWhite: '#c0caf5'
    }
  },

  'nord': {
    name: 'Nord',
    colors: {
      background: '#2e3440',
      foreground: '#d8dee9',
      cursor: '#eceff4',
      cursorAccent: '#2e3440',
      selectionBackground: '#434c5e',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#e5e9f0',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4'
    }
  },

  'rose-pine': {
    name: 'Rosé Pine',
    colors: {
      background: '#191724',
      foreground: '#e0def4',
      cursor: '#e0def4',
      cursorAccent: '#191724',
      selectionBackground: '#26233a',
      black: '#26233a',
      red: '#eb6f92',
      green: '#9ccfd8',
      yellow: '#f6c177',
      blue: '#31748f',
      magenta: '#c4a7e7',
      cyan: '#ebbcba',
      white: '#e0def4',
      brightBlack: '#6e6a86',
      brightRed: '#eb6f92',
      brightGreen: '#9ccfd8',
      brightYellow: '#f6c177',
      brightBlue: '#31748f',
      brightMagenta: '#c4a7e7',
      brightCyan: '#ebbcba',
      brightWhite: '#e0def4'
    }
  },

  'gruvbox-dark': {
    name: 'Gruvbox Dark',
    colors: {
      background: '#282828',
      foreground: '#ebdbb2',
      cursor: '#ebdbb2',
      cursorAccent: '#282828',
      selectionBackground: '#665c54',
      black: '#282828',
      red: '#cc241d',
      green: '#98971a',
      yellow: '#d79921',
      blue: '#458588',
      magenta: '#b16286',
      cyan: '#689d6a',
      white: '#a89984',
      brightBlack: '#928374',
      brightRed: '#fb4934',
      brightGreen: '#b8bb26',
      brightYellow: '#fabd2f',
      brightBlue: '#83a598',
      brightMagenta: '#d3869b',
      brightCyan: '#8ec07c',
      brightWhite: '#ebdbb2'
    }
  },

  'solarized-dark': {
    name: 'Solarized Dark',
    colors: {
      background: '#002b36',
      foreground: '#839496',
      cursor: '#839496',
      cursorAccent: '#002b36',
      selectionBackground: '#073642',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    }
  },

  'ubuntu': {
    name: 'Ubuntu',
    colors: {
      background: '#300a24',
      foreground: '#eeeeec',
      cursor: '#bbbbbb',
      cursorAccent: '#300a24',
      selectionBackground: '#b5d5ff',
      black: '#2e3436',
      red: '#cc0000',
      green: '#4e9a06',
      yellow: '#c4a000',
      blue: '#3465a4',
      magenta: '#75507b',
      cyan: '#06989a',
      white: '#d3d7cf',
      brightBlack: '#555753',
      brightRed: '#ef2929',
      brightGreen: '#8ae234',
      brightYellow: '#fce94f',
      brightBlue: '#729fcf',
      brightMagenta: '#ad7fa8',
      brightCyan: '#34e2e2',
      brightWhite: '#eeeeec'
    }
  },

  // ═══════════════════════════════════════════
  //  Light Themes (10)
  // ═══════════════════════════════════════════

  'catppuccin-latte': {
    name: 'Catppuccin Latte',
    colors: {
      background: '#eff1f5',
      foreground: '#4c4f69',
      cursor: '#dc8a78',
      cursorAccent: '#eff1f5',
      selectionBackground: '#acb0be',
      black: '#5c5f77',
      red: '#d20f39',
      green: '#40a02b',
      yellow: '#df8e1d',
      blue: '#1e66f5',
      magenta: '#ea76cb',
      cyan: '#179299',
      white: '#acb0be',
      brightBlack: '#6c6f85',
      brightRed: '#d20f39',
      brightGreen: '#40a02b',
      brightYellow: '#df8e1d',
      brightBlue: '#1e66f5',
      brightMagenta: '#ea76cb',
      brightCyan: '#179299',
      brightWhite: '#bcc0cc'
    }
  },

  'one-light': {
    name: 'One Light',
    colors: {
      background: '#f9f9f9',
      foreground: '#2a2c33',
      cursor: '#bbbbbb',
      cursorAccent: '#f9f9f9',
      selectionBackground: '#ededed',
      black: '#000000',
      red: '#de3e35',
      green: '#3f953a',
      yellow: '#d2b67c',
      blue: '#2f5af3',
      magenta: '#950095',
      cyan: '#3f953a',
      white: '#bbbbbb',
      brightBlack: '#000000',
      brightRed: '#de3e35',
      brightGreen: '#3f953a',
      brightYellow: '#d2b67c',
      brightBlue: '#2f5af3',
      brightMagenta: '#a00095',
      brightCyan: '#3f953a',
      brightWhite: '#ffffff'
    }
  },

  'github-light': {
    name: 'GitHub Light',
    colors: {
      background: '#f4f4f4',
      foreground: '#3e3e3e',
      cursor: '#3f3f3f',
      cursorAccent: '#f4f4f4',
      selectionBackground: '#a9c1e2',
      black: '#3e3e3e',
      red: '#970b16',
      green: '#07962a',
      yellow: '#f8eec7',
      blue: '#003e8a',
      magenta: '#e94691',
      cyan: '#89d1ec',
      white: '#ffffff',
      brightBlack: '#666666',
      brightRed: '#de0000',
      brightGreen: '#87d5a2',
      brightYellow: '#f1d007',
      brightBlue: '#2e6cba',
      brightMagenta: '#ffa29f',
      brightCyan: '#1cfafe',
      brightWhite: '#ffffff'
    }
  },

  'solarized-light': {
    name: 'Solarized Light',
    colors: {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#657b83',
      cursorAccent: '#fdf6e3',
      selectionBackground: '#eee8d5',
      black: '#073642',
      red: '#dc322f',
      green: '#859900',
      yellow: '#b58900',
      blue: '#268bd2',
      magenta: '#d33682',
      cyan: '#2aa198',
      white: '#eee8d5',
      brightBlack: '#002b36',
      brightRed: '#cb4b16',
      brightGreen: '#586e75',
      brightYellow: '#657b83',
      brightBlue: '#839496',
      brightMagenta: '#6c71c4',
      brightCyan: '#93a1a1',
      brightWhite: '#fdf6e3'
    }
  },

  'gruvbox-light': {
    name: 'Gruvbox Light',
    colors: {
      background: '#fbf1c7',
      foreground: '#282828',
      cursor: '#282828',
      cursorAccent: '#fbf1c7',
      selectionBackground: '#d5c4a1',
      black: '#fbf1c7',
      red: '#9d0006',
      green: '#79740e',
      yellow: '#b57614',
      blue: '#076678',
      magenta: '#8f3f71',
      cyan: '#427b58',
      white: '#3c3836',
      brightBlack: '#9d8374',
      brightRed: '#cc241d',
      brightGreen: '#98971a',
      brightYellow: '#d79921',
      brightBlue: '#458588',
      brightMagenta: '#b16186',
      brightCyan: '#689d69',
      brightWhite: '#7c6f64'
    }
  },

  'rose-pine-dawn': {
    name: 'Rosé Pine Dawn',
    colors: {
      background: '#faf4ed',
      foreground: '#575279',
      cursor: '#575279',
      cursorAccent: '#faf4ed',
      selectionBackground: '#f2e9e1',
      black: '#f2e9e1',
      red: '#b4637a',
      green: '#56949f',
      yellow: '#ea9d34',
      blue: '#286983',
      magenta: '#907aa9',
      cyan: '#d7827e',
      white: '#575279',
      brightBlack: '#9893a5',
      brightRed: '#b4637a',
      brightGreen: '#56949f',
      brightYellow: '#ea9d34',
      brightBlue: '#286983',
      brightMagenta: '#907aa9',
      brightCyan: '#d7827e',
      brightWhite: '#575279'
    }
  },

  'tokyo-night-light': {
    name: 'Tokyo Night Light',
    colors: {
      background: '#e1e2e7',
      foreground: '#3760bf',
      cursor: '#3760bf',
      cursorAccent: '#e1e2e7',
      selectionBackground: '#99a7df',
      black: '#e9e9ed',
      red: '#f52a65',
      green: '#587539',
      yellow: '#8c6c3e',
      blue: '#2e7de9',
      magenta: '#9854f1',
      cyan: '#007197',
      white: '#6172b0',
      brightBlack: '#a1a6c5',
      brightRed: '#f52a65',
      brightGreen: '#587539',
      brightYellow: '#8c6c3e',
      brightBlue: '#2e7de9',
      brightMagenta: '#9854f1',
      brightCyan: '#007197',
      brightWhite: '#3760bf'
    }
  },

  'nord-light': {
    name: 'Nord Light',
    colors: {
      background: '#e5e9f0',
      foreground: '#414858',
      cursor: '#88c0d0',
      cursorAccent: '#e5e9f0',
      selectionBackground: '#d8dee9',
      black: '#3b4252',
      red: '#bf616a',
      green: '#a3be8c',
      yellow: '#ebcb8b',
      blue: '#81a1c1',
      magenta: '#b48ead',
      cyan: '#88c0d0',
      white: '#d8dee9',
      brightBlack: '#4c566a',
      brightRed: '#bf616a',
      brightGreen: '#a3be8c',
      brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1',
      brightMagenta: '#b48ead',
      brightCyan: '#8fbcbb',
      brightWhite: '#eceff4'
    }
  },

  'everforest-light': {
    name: 'Everforest Light',
    colors: {
      background: '#fdf6e3',
      foreground: '#5c6a72',
      cursor: '#5c6a72',
      cursorAccent: '#fdf6e3',
      selectionBackground: '#e5dfc5',
      black: '#5c6a72',
      red: '#f85552',
      green: '#8da101',
      yellow: '#dfa000',
      blue: '#3a94c5',
      magenta: '#df69ba',
      cyan: '#35a77c',
      white: '#dfddc8',
      brightBlack: '#8a8980',
      brightRed: '#f85552',
      brightGreen: '#8da101',
      brightYellow: '#dfa000',
      brightBlue: '#3a94c5',
      brightMagenta: '#df69ba',
      brightCyan: '#35a77c',
      brightWhite: '#fdf6e3'
    }
  },

  'ayu-light': {
    name: 'Ayu Light',
    colors: {
      background: '#fafafa',
      foreground: '#5c6773',
      cursor: '#ff6a00',
      cursorAccent: '#fafafa',
      selectionBackground: '#f0eee4',
      black: '#000000',
      red: '#ff3333',
      green: '#86b300',
      yellow: '#f29718',
      blue: '#41a6d9',
      magenta: '#f07178',
      cyan: '#4dbf99',
      white: '#ffffff',
      brightBlack: '#323232',
      brightRed: '#ff6565',
      brightGreen: '#b8e532',
      brightYellow: '#ffc94a',
      brightBlue: '#73d8ff',
      brightMagenta: '#ffa3aa',
      brightCyan: '#7ff1cb',
      brightWhite: '#ffffff'
    }
  }
}
