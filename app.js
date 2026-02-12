const startButton = document.getElementById("startButton");
const statusEl = document.getElementById("status");
const videoEl = document.getElementById("inputVideo");
const canvasEl = document.getElementById("overlayCanvas");
const pitchEl = document.getElementById("pitchValue");
const volumeEl = document.getElementById("volumeValue");
const leftHandEl = document.getElementById("leftHandState");
const rightHandEl = document.getElementById("rightHandState");

const ctx = canvasEl.getContext("2d");

const MIN_FREQ = 110;
const MAX_FREQ = 1318.51;
const MAX_GAIN = 0.38;
const SMOOTHING = 0.2;

const LEFT_HAND_COLOR = "#44dcb0";
const RIGHT_HAND_COLOR = "#ff8f5a";
const PITCH_ANTENNA_COLOR = "#3dd5f3";
const VOLUME_ANTENNA_COLOR = "#ffe08a";

// Antenna geometry in normalized camera coordinates.
const PITCH_ANTENNA = { x: 0.14, y1: 0.12, y2: 0.88 };
const VOLUME_ANTENNA = { x1: 0.58, x2: 0.94, y: 0.82 };

const PITCH_DISTANCE_RANGE = { near: 0.02, far: 0.55 };
const VOLUME_DISTANCE_RANGE = { near: 0.02, far: 0.62 };

let audioCtx;
let oscillator;
let gainNode;
let started = false;
let smoothedPitchControl = 0.5;
let smoothedVolumeProximity = 0.5;
let trackingStatus = "";

function setStatus(message) {
  statusEl.textContent = message;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setHandState(element, isTracking) {
  element.textContent = isTracking ? "Tracking" : "Missing";
  element.classList.toggle("active", isTracking);
  element.classList.toggle("missing", !isTracking);
}

function setTrackingStatus(hasLeft, hasRight) {
  const next = `${hasLeft ? "1" : "0"}${hasRight ? "1" : "0"}`;
  if (next === trackingStatus) {
    return;
  }

  trackingStatus = next;

  if (hasLeft && hasRight) {
    setStatus("Both hands tracked. Left controls pitch, right controls volume.");
    return;
  }

  if (!hasLeft && !hasRight) {
    setStatus("Show both hands in frame to play.");
    return;
  }

  if (!hasLeft) {
    setStatus("Left hand missing. Left hand controls pitch.");
    return;
  }

  setStatus("Right hand missing. Right hand controls volume.");
}

function mapControlToFrequency(control) {
  const normalized = clamp(control, 0, 1);
  const ratio = MAX_FREQ / MIN_FREQ;
  return MIN_FREQ * Math.pow(ratio, normalized);
}

function mapProximityToVolume(proximity) {
  // Theremin-like response: closer to volume antenna reduces loudness.
  const openness = clamp(1 - proximity, 0, 1);
  return Math.pow(openness, 1.35);
}

function inverseSquareNormalized(distance, nearDistance, farDistance) {
  const clamped = clamp(distance, nearDistance, farDistance);
  const strength = 1 / (clamped * clamped);
  const nearStrength = 1 / (nearDistance * nearDistance);
  const farStrength = 1 / (farDistance * farDistance);
  return clamp((strength - farStrength) / (nearStrength - farStrength), 0, 1);
}

function pitchAnchorForPoint(point) {
  return {
    x: PITCH_ANTENNA.x,
    y: clamp(point.y, PITCH_ANTENNA.y1, PITCH_ANTENNA.y2),
  };
}

function volumeAnchorForPoint(point) {
  return {
    x: clamp(point.x, VOLUME_ANTENNA.x1, VOLUME_ANTENNA.x2),
    y: VOLUME_ANTENNA.y,
  };
}

function distance(point, anchor) {
  return Math.hypot(point.x - anchor.x, point.y - anchor.y);
}

function initAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) {
    throw new Error("Web Audio API is not supported in this browser.");
  }

  audioCtx = new AudioCtx();
  oscillator = audioCtx.createOscillator();
  gainNode = audioCtx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = 440;
  gainNode.gain.value = 0;

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  oscillator.start();
}

function updateSynth(pitchControl, volumeProximity, hasLeft, hasRight) {
  if (!audioCtx) {
    return;
  }

  const now = audioCtx.currentTime;

  if (hasLeft) {
    smoothedPitchControl += (pitchControl - smoothedPitchControl) * SMOOTHING;
    const frequency = mapControlToFrequency(smoothedPitchControl);
    oscillator.frequency.setTargetAtTime(frequency, now, 0.045);
    pitchEl.textContent = `${Math.round(frequency)} Hz`;
  } else {
    pitchEl.textContent = "-- Hz";
  }

  let volume = 0;
  if (hasRight) {
    smoothedVolumeProximity += (volumeProximity - smoothedVolumeProximity) * SMOOTHING;
    volume = mapProximityToVolume(smoothedVolumeProximity);
    volumeEl.textContent = `${Math.round(volume * 100)}%`;
  } else {
    volumeEl.textContent = "-- %";
  }

  if (hasLeft && hasRight) {
    gainNode.gain.setTargetAtTime(volume * MAX_GAIN, now, 0.05);
  } else {
    gainNode.gain.setTargetAtTime(0, now, 0.06);
  }
}

function resizeCanvas() {
  if (canvasEl.width === videoEl.videoWidth && canvasEl.height === videoEl.videoHeight) {
    return;
  }

  canvasEl.width = videoEl.videoWidth;
  canvasEl.height = videoEl.videoHeight;
}

function drawAntennaOverlay() {
  const width = canvasEl.width;
  const height = canvasEl.height;

  ctx.save();
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 8]);

  const pitchX = PITCH_ANTENNA.x * width;
  const pitchY1 = PITCH_ANTENNA.y1 * height;
  const pitchY2 = PITCH_ANTENNA.y2 * height;

  ctx.strokeStyle = PITCH_ANTENNA_COLOR;
  ctx.shadowBlur = 14;
  ctx.shadowColor = PITCH_ANTENNA_COLOR;
  ctx.beginPath();
  ctx.moveTo(pitchX, pitchY1);
  ctx.lineTo(pitchX, pitchY2);
  ctx.stroke();

  const volumeX1 = VOLUME_ANTENNA.x1 * width;
  const volumeX2 = VOLUME_ANTENNA.x2 * width;
  const volumeY = VOLUME_ANTENNA.y * height;

  ctx.strokeStyle = VOLUME_ANTENNA_COLOR;
  ctx.shadowColor = VOLUME_ANTENNA_COLOR;
  ctx.beginPath();
  ctx.moveTo(volumeX1, volumeY);
  ctx.lineTo(volumeX2, volumeY);
  ctx.stroke();

  ctx.restore();
}

function drawGuide(point, anchor, color) {
  const width = canvasEl.width;
  const height = canvasEl.height;

  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.setLineDash([5, 6]);
  ctx.beginPath();
  ctx.moveTo(point.x * width, point.y * height);
  ctx.lineTo(anchor.x * width, anchor.y * height);
  ctx.stroke();
  ctx.restore();
}

function drawHand(landmarks, color) {
  window.drawConnectors(ctx, landmarks, window.HAND_CONNECTIONS, {
    color,
    lineWidth: 2.5,
  });

  window.drawLandmarks(ctx, landmarks, {
    color,
    lineWidth: 1,
    radius: 3,
  });
}

function handednessLabel(handedness) {
  if (!handedness) {
    return "";
  }

  if (Array.isArray(handedness)) {
    return handedness[0]?.label?.toLowerCase() || "";
  }

  if (typeof handedness.label === "string") {
    return handedness.label.toLowerCase();
  }

  return "";
}

function pickHands(results) {
  const landmarksList = results.multiHandLandmarks || [];
  const handednessList = results.multiHandedness || [];

  let left = null;
  let right = null;

  for (let i = 0; i < landmarksList.length; i += 1) {
    const landmarks = landmarksList[i];
    const label = handednessLabel(handednessList[i]);

    if (label.includes("left") && !left) {
      left = landmarks;
      continue;
    }

    if (label.includes("right") && !right) {
      right = landmarks;
    }
  }

  if ((!left || !right) && landmarksList.length >= 2) {
    const sortedByX = [...landmarksList].sort((a, b) => a[0].x - b[0].x);
    if (!left) {
      left = sortedByX[0];
    }
    if (!right) {
      right = sortedByX[sortedByX.length - 1];
    }
  }

  if (!left && !right && landmarksList.length === 1) {
    if (landmarksList[0][0].x < 0.5) {
      left = landmarksList[0];
    } else {
      right = landmarksList[0];
    }
  }

  return { left, right };
}

function drawResults(results) {
  resizeCanvas();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  drawAntennaOverlay();

  const { left, right } = pickHands(results);

  let pitchControl = smoothedPitchControl;
  let volumeProximity = smoothedVolumeProximity;

  let hasLeft = false;
  let hasRight = false;

  if (left) {
    drawHand(left, LEFT_HAND_COLOR);

    const leftIndexTip = left[8];
    if (leftIndexTip) {
      hasLeft = true;
      const pitchAnchor = pitchAnchorForPoint(leftIndexTip);
      const pitchDistance = distance(leftIndexTip, pitchAnchor);
      pitchControl = inverseSquareNormalized(
        pitchDistance,
        PITCH_DISTANCE_RANGE.near,
        PITCH_DISTANCE_RANGE.far,
      );
      drawGuide(leftIndexTip, pitchAnchor, PITCH_ANTENNA_COLOR);
    }
  }

  if (right) {
    drawHand(right, RIGHT_HAND_COLOR);

    const rightIndexTip = right[8];
    if (rightIndexTip) {
      hasRight = true;
      const volumeAnchor = volumeAnchorForPoint(rightIndexTip);
      const volumeDistance = distance(rightIndexTip, volumeAnchor);
      volumeProximity = inverseSquareNormalized(
        volumeDistance,
        VOLUME_DISTANCE_RANGE.near,
        VOLUME_DISTANCE_RANGE.far,
      );
      drawGuide(rightIndexTip, volumeAnchor, VOLUME_ANTENNA_COLOR);
    }
  }

  setHandState(leftHandEl, hasLeft);
  setHandState(rightHandEl, hasRight);
  setTrackingStatus(hasLeft, hasRight);
  updateSynth(pitchControl, volumeProximity, hasLeft, hasRight);
}

async function initHandTracking() {
  const hands = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.6,
  });

  hands.onResults(drawResults);

  const camera = new window.Camera(videoEl, {
    onFrame: async () => {
      await hands.send({ image: videoEl });
    },
    width: 960,
    height: 720,
  });

  await camera.start();
}

async function start() {
  if (started) {
    return;
  }

  try {
    if (!window.Hands || !window.Camera || !window.drawConnectors || !window.drawLandmarks) {
      throw new Error("MediaPipe assets did not load.");
    }

    started = true;
    startButton.disabled = true;
    setStatus("Starting camera and audio...");

    initAudio();
    if (audioCtx.state === "suspended") {
      await audioCtx.resume();
    }

    await initHandTracking();
    setStatus("Show both hands in frame to play.");
  } catch (error) {
    console.error(error);
    started = false;
    startButton.disabled = false;
    setStatus("Could not start camera/audio. Check permissions and reload.");
  }
}

setHandState(leftHandEl, false);
setHandState(rightHandEl, false);
startButton.addEventListener("click", start);
