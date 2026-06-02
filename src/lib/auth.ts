export const APP_PASSWORD = "metsrb123";
export const AUTH_KEY = "see_td_auth";

export function hasSimpleAuth() {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(AUTH_KEY) === "1";
}