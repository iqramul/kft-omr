# OMR Scanner (KFT Collegiate School)

Static web app (no build step), auto-deployed to Vercel on every push to `main`.

## Rules
- **Bump the version on every push.** The version is shown in the header next to "by Iqramul"
  (`<span class="ver-badge">vX.Y</span>` in `index.html`). Increase it by 0.1 for each push
  (v1.9 → v2.0 → v2.1 …) and mention the new version in the commit message.
- Never commit students' photos or other test images (they contain names); keep them out of the repo.

## Files
- `omr.js` — detection (40 blue question-number boxes as anchors) + bubble reading
- `template.js` — calibrated positions in unit coords (sheet corner markers = unit square)
- `app.js` — UI, camera, storage (localStorage)
