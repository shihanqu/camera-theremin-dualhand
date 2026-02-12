# Camera Theremin

A static web app that uses your webcam to track both hands and generate theremin-style audio.

- Left hand controls pitch based on distance to a vertical pitch antenna overlay.
- Right hand controls volume based on distance to a horizontal volume antenna overlay.
- Pitch and volume use an inverse-square distance response.

## Run locally

You can open `index.html` directly, but camera permissions are often more reliable over a local server:

```bash
npx serve .
```

Then open the local URL and click **Start Theremin**.

## Deploy to Surge

1. Install Surge (once):

```bash
npm install --global surge
```

2. From this folder, deploy:

```bash
surge . your-theremin-app.surge.sh
```

3. Open your Surge URL and allow camera + audio permissions.
