// Netlify Functions need an absolute URL so the Capacitor app can use them too.
export const SHARE_API_BASE_URL = "https://guitarmate.netlify.app";

export const shareApiUrl = (path: string) =>
  `${SHARE_API_BASE_URL}/.netlify/functions/${path}`;
