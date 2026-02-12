# Camera Theremin

A browser theremin that uses your webcam to track both hands and control sound in real time.

## Live Demo

https://shihanqu.github.io/camera-theremin-dualhand/

## Controls

- Left hand: pitch (distance to vertical pitch antenna)
- Right hand: volume (distance to horizontal volume antenna)
- Uses inverse-square distance mapping for both controls

## Run Locally

```bash
npx serve .
```

Open the local URL, allow camera + audio permissions, then click **Start Theremin**.
