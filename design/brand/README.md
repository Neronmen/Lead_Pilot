# Brand files

| File | What it is | Where it is used |
| --- | --- | --- |
| `leadpilot.svg` | The LeadPilot logo (source of truth) | App sidebar and auth pages (`apps/web/public/brand/leadpilot.svg`), the favicon (`apps/web/app/icon.svg`), the design canvas |
| `leadpilot-240.png` | The same logo as a 240×240 PNG, transparent corners | The invite email (`apps/web/public/email/logo.png`, shown at 28 px, so it stays sharp on retina) |
| `neronmen.svg`, `neronmen.png` | The developer's personal brand (512×512 PNG) | **Never in the product UI.** Portfolio and README only. |

## Rules

- Use the logo as it is. Do not redraw, recolour, crop, stretch or add effects. It is a dark rounded square, so it reads on both the dark and the light theme.
- The PNGs are renders of the SVGs, not separate artwork. To change a logo, edit the SVG, then run:

  ```bash
  pnpm --filter web icons
  ```

  This re-renders every PNG and icon (Chromium draws the SVG on a transparent page) and copies the files to where the web app serves them: `leadpilot-240.png`, `neronmen.png`, `apps/web/public/email/logo.png`, `apps/web/public/brand/leadpilot.svg`, `apps/web/app/icon.svg`, `apps/web/app/apple-icon.png` (180×180) and `apps/web/app/favicon.ico` (16, 32 and 48 px). Commit the results.
