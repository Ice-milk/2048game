This is a small 2048 game built with Next.js.

## Features

- Keyboard control on desktop
- Swipe control on mobile
- Device motion / shake control on supported phones
- Local best score persistence
- Simple in-browser gameplay with no backend

## Development

```bash
npm install
npm run dev
```

Open http://localhost:3000 to play.

## Notes

- On iPhone/iPad, motion control may require explicit permission.
- Add `?debug=1` to the URL to show motion debug data.
- Core 2048 logic lives in `lib/game2048.ts`.
