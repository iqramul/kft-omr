# OMR Scanner — KFT Collegiate School

Static web app (no build step). Scans the KFT Collegiate School 40-question OMR sheet with the phone camera and shows the result live.

## Deploy to Vercel
This repo is connected to Vercel: every push to `main` deploys automatically.

First-time setup: vercel.com/new → Import this GitHub repo → Framework Preset **Other**, no build command, output directory `./` → Deploy.

Camera only works over HTTPS (Vercel gives HTTPS automatically).

## Use
1. **সেটআপ** — subject name, number of questions, marks per correct / negative per wrong, then the answer key for each set (A/B/C/D). Tap bubbles or type e.g. `ABCDDCBA...` (`-` = no key). Everything is saved in the browser (localStorage).
2. **স্ক্যান** — pick the set (A/B/C/D) at the top, point the camera at the sheet so all 4 small corner squares are visible. Live overlay:
   - green filled dot = correct answer marked
   - red filled dot = wrong mark (also multiple marks)
   - green ring = the correct answer for that question
   When the chip says "রেজাল্ট স্থির ✓", press **সেভ করুন**. Student ID is read from the ID bubbles.
3. **রেজাল্ট** — saved scores per subject, CSV export.

## Files
- `template.js` — bubble positions calibrated from the sheet (unit square between the 4 corner markers)
- `omr.js` — marker detection, homography, bubble fill reading (pure JS)
- `app.js` — UI, camera, storage
