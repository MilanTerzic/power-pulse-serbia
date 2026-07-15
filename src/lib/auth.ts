const APP_PASSWORD = "metsrb123";
const AUTH_KEY = "power-pulse-auth";

export function hasAppSession() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem(AUTH_KEY) === "ok";
}

export function signInWithPassword(password: string) {
  if (password !== APP_PASSWORD) return false;
  window.localStorage.setItem(AUTH_KEY, "ok");
  return true;
}

export function signOut() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(AUTH_KEY);
  }
}
