export type ThemeName = "light" | "dark";

export function currentTheme(): ThemeName {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function applyTheme(theme: ThemeName) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem("sentinel-theme", theme);
  window.dispatchEvent(new Event("sentinel-theme"));
}

export function toggleTheme() {
  applyTheme(currentTheme() === "dark" ? "light" : "dark");
}
