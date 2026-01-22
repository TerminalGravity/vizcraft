/**
 * Styling Module
 * Premium diagram styling and theming
 */

export {
  type Theme,
  type ThemeColors,
  themes,
  getTheme,
  listThemes,
  getNodeColor,
  darkTheme,
  lightTheme,
  professionalTheme,
  vibrantTheme,
  minimalTheme,
  oceanTheme,
} from "./themes";

export { applyThemeToDiagram, generateStyledCSS } from "./apply";
