# Air Pen+ ✍️

Draw on a wall with your fingertip using a webcam, a projector and your browser. No install, no backend, no build step.

<!-- Add your demo here once you have it: -->
<!-- ![Air Pen+ demo](assets/demo.gif) -->

## What it does

1. The webcam tracks your hand with [MediaPipe Hands](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker).
2. The browser draws a glowing line wherever your pinch point goes.
3. The projector shows the browser tab, so the wall becomes the canvas.

## What's new in Air Pen+

Air Pen+ keeps the idea and the controls of [gprem09/air-pen](https://github.com/gprem09/air-pen) and adds:

- **Pinch to draw.** Touch thumb and index finger together. No keyboard needed (Shift still works).
- **Projector calibration (press K).** Pinch and hold on 4 dots on the wall. A homography maps the camera view onto the projected image, so the line appears where your finger touches the wall instead of drifting with the camera angle.
- **One Euro filter.** Smooths jitter when you move slowly and stays responsive when you move fast.
- **Efficiency-minded rendering:**
  - Hand detection runs only when the camera delivers a new frame.
  - GPU delegate with CPU fallback, one hand tracked.
  - The glow is a quarter-resolution layer blurred by the browser (no `shadowBlur`).
  - Only the newest line segment is painted each frame, and near-duplicate points are skipped.
- **Extras:** undo (also restores a cleared drawing), six colours, brush size, camera preview toggle, on-screen controls panel and a speed counter (press P).

## Run it

You need Python (to serve the files locally) and Chrome or Edge on a desktop computer with a webcam.

```bash
git clone https://github.com/summaira-muzaffar/air-pen-plus.git
cd air-pen-plus
python3 -m http.server 8000      # on Windows: py -m http.server 8000
```

Open <http://localhost:8000>, allow camera access, then send the tab to your projector and press `F` for fullscreen.

If the default server fails on Windows, run `py serve.py` instead. It opens the app for you.

The app loads MediaPipe from a CDN, so you need an internet connection the first time.

## Controls

| Key | Action |
| --- | --- |
| Pinch | Draw (thumb + index finger together) |
| `Shift` (hold) | Draw without pinching |
| `Space` | Clear |
| `Z` | Undo (also restores a cleared drawing) |
| `C` | Change colour |
| `[` / `]` | Thinner / thicker brush |
| `K` | Calibrate to the projector |
| `R` | Reset calibration |
| `M` | Mirror left/right (when not calibrated) |
| `V` | Show / hide camera preview |
| `P` | Show / hide speed stats |
| `H` | Show / hide the controls panel |
| `F` | Fullscreen |

## Calibrating for a projector

1. Point the webcam so it can see the whole projected image on the wall.
2. Press `K`.
3. Pinch and hold the pinch point on each of the 4 dots until the ring fills.
4. Done. The calibration is saved in your browser. Press `R` to reset it.

Recalibrate whenever you move the camera or the projector.

## How it works

- **Tracking:** MediaPipe returns 21 landmarks per hand. The pinch point is the midpoint of the thumb tip and index tip. A pinch is detected when their distance is small relative to hand size, with hysteresis so it doesn't flicker.
- **Smoothing:** a One Euro filter on the pinch point.
- **Calibration:** four camera-to-screen point pairs give a 3×3 homography, solved by Gaussian elimination in plain JavaScript.
- **Rendering:** strokes are stored as normalised points, so they survive resizing and fullscreen. A sharp core layer and a low-resolution glow layer are drawn separately.

## Performance

Press `P` to see fps, detection time and draw time. Measured on my machine:

| Version | fps | detect (ms) | draw (ms) |
| --- | --- | --- | --- |
| air-pen (original) | _fill in_ | _fill in_ | _fill in_ |
| Air Pen+ | _fill in_ | _fill in_ | _fill in_ |

_Machine and camera: fill in._

## Limitations

- One camera cannot sense depth. Calibration assumes your pinch point is on the wall surface. A hand held away from the wall appears shifted.
- Calibration is invalid once the camera or projector moves.
- Built and tested for desktop Chrome/Edge. Other browsers may work but are untested.
- One hand only.
- Needs internet on first load (MediaPipe model and WASM come from a CDN).

## Tuning

At the top of `script.js`: `PINCH_ON` / `PINCH_OFF` (pinch sensitivity), `MIN_STEP`, `GLOW_SCALE`. In the `OneEuro` class: `minCutoff` (higher = more responsive, more jitter) and `beta` (higher = less lag when moving fast).

## Credits

- Inspired by [gprem09/air-pen](https://github.com/gprem09/air-pen). Air Pen+ is an independent implementation of the same idea.
- Hand tracking by [MediaPipe](https://developers.google.com/mediapipe).

## License

MIT, see [LICENSE](LICENSE).