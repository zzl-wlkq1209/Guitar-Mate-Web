# Guitar Mate Web

A web-only React and Vite build of Guitar Mate for Netlify deployment.

## Local Development

```powershell
npm install
npm run dev
```

## Production Build

```powershell
npm run build
```

## Netlify

Connect this repository in Netlify and use:

- Build command: `npm run build`
- Publish directory: `dist`

The included `netlify.toml` already sets these values and adds an SPA fallback.
