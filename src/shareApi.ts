// Netlify Functions use an absolute URL so shared codes work from every web deployment.
export const SHARE_API_BASE_URL = "https://guitarmate.netlify.app";

export const shareApiUrl = (path: string) =>
  `${SHARE_API_BASE_URL}/.netlify/functions/${path}`;
