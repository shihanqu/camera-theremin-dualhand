# Camera Theremin

A browser theremin that uses your webcam to track both hands and control sound in real time.

## Live Demo

https://shihanqu.github.io/camera-theremin-dualhand/

## Controls

- Right-handed mode (default): right hand = pitch, left hand = volume
- Left-handed mode: left hand = pitch, right hand = volume
- Pitch hand: closer to vertical antenna = higher pitch
- Volume hand: closer to horizontal loop = quieter / mute
- Inverse-square distance mapping for pitch and volume
- Includes a `Pitch Field` slider (theremin-style pitch range tuning)

## Run Locally

```bash
npx serve .
```

Open the local URL, allow camera + audio permissions, then click **Start Theremin**.
