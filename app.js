const startButton = document.getElementById("startButton");
const statusEl = document.getElementById("status");
const videoEl = document.getElementById("inputVideo");
const canvasEl = document.getElementById("overlayCanvas");
const pitchEl = document.getElementById("pitchValue");
const volumeEl = document.getElementById("volumeValue");
const pitchHandStateEl = document.getElementById("pitchHandState");
const volumeHandStateEl = document.getElementById("volumeHandState");

const modeRightEl = document.getElementById("modeRight");
const modeLeftEl = document.getElementById("modeLeft");

const pitchHandLabelEl = document.getElementById("pitchHandLabel");
const volumeHandLabelEl = document.getElementById("volumeHandLabel");
const pitchHandLegendEl = document.getElementById("pitchHandLegend");
const volumeHandLegendEl = document.getElementById("volumeHandLegend");

const pitchFieldEl = document.getElementById("pitchField");
const pitchFieldValueEl = document.getElementById("pitchFieldValue");

const ctx = canvasEl.getContext("2d");

const MIN_FREQ = 65.41; // C2
const MAX_FREQ = 2093.0; // C7
const MAX_GAIN = 0.38;
const SMOOTHING = 0.2;
const PITCH_LOG_CURVE = 14;

const PITCH_HAND_COLOR = "#ff8f5a";
const VOLUME_HAND_COLOR = "#44dcb0";
const PITCH_ANTENNA_COLOR = "#3dd5f3";
const VOLUME_ANTENNA_COLOR = "#ffe08a";

const HAND_MODES = {
  right: {
    pitchLabel: "right",
    volumeLabel: "left",
    // Mirrored webcam view: lower x renders on the right side of screen.
    pitchAntenna: { x: 0.14, y1: 0.12, y2: 0.88 },
    volumeAntenna: { x1: 0.62, x2: 0.94, y: 0.82 },
  },
  left: {
    pitchLabel: "left",
    volumeLabel: "right",
    pitchAntenna: { x: 0.86, y1: 0.12, y2: 0.88 },
    volumeAntenna: { x1: 0.06, x2: 0.38, y: 0.82 },
  },
};

const PITCH_DISTANCE_RANGE = { near: 0.018, far: 0.4 };
const VOLUME_DISTANCE_RANGE = { near: 0.02, far: 0.5 };

let playMode = "right";

let audioCtx;
let oscillator;
let gainNode;
let started = false;
let smoothedPitchControl = 0.45;
let smoothedVolumeProximity = 1;
let trackingStatus = "";

function setStatus(message) {
  statusEl.textContent = message;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function capitalize(word) {
  if (!word) {
    return "";
  }

  return word.charAt(0).toUpperCase() + word.slice(1);
}

function currentConfig() {
  return HAND_MODES[playMode];
}

function updateRoleLabels() {
  const config = currentConfig();
  const pitchHandText = `${capitalize(config.pitchLabel)} Hand`;
  const volumeHandText = `${capitalize(config.volumeLabel)} Hand`;

  pitchHandLabelEl.textContent = pitchHandText;
  volumeHandLabelEl.textContent = volumeHandText;
  pitchHandLegendEl.textContent = pitchHandText;
  volumeHandLegendEl.textContent = volumeHandText;
}

function updatePitchField() {
  const normalized = Number(pitchFieldEl.value) / 100;
  PITCH_DISTANCE_RANGE.far = normalized;
  pitchFieldValueEl.textContent = normalized.toFixed(2);
}

function setHandState(element, isTracking) {
  element.textContent = isTracking ? "Tracking" : "Missing";
  element.classList.toggle("active", isTracking);
  element.classList.toggle("missing", !isTracking);
}

function setTrackingStatus(hasPitchHand, hasVolumeHand) {
  const config = currentConfig();
  const next = `${hasPitchHand ? "1" : "0"}${hasVolumeHand ? "1" : "0"}${playMode}`;
  if (trackingStatus === next) {
    return;
  }

  trackingStatus = next;

  if (hasPitchHand && hasVolumeHand) {
    setStatus(
      `${capitalize(config.pitchLabel)} hand controls pitch, ${config.volumeLabel} hand controls volume.`,
    );
    return;
  }

  if (!hasPitchHand && !hasVolumeHand) {
    setStatus("Show both control hands in frame to play.");
    return;
  }

  if (!hasPitchHand) {
    setStatus(`${capitalize(config.pitchLabel)} hand missing (pitch hand).`);
    return;
  }

  setStatus(`${capitalize(config.volumeLabel)} hand missing (volume hand).`);
}

function mapControlToFrequency(control) {
  const normalized = clamp(control, 0, 1);
  const ratio = MAX_FREQ / MIN_FREQ;
  return MIN_FREQ * Math.pow(ratio, normalized);
}

function mapProximityToVolume(proximity) {
  // Standard theremin behavior: closer to volume loop mutes the sound.
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

function distanceToPitchControl(distance, nearDistance, farDistance) {
  const clamped = clamp(distance, nearDistance, farDistance);
  const normalizedDistance = (clamped - nearDistance) / (farDistance - nearDistance);

  // Log-style pitch field: broad movement for low notes, tighter movement near antenna.
  const compressed = Math.log1p(PITCH_LOG_CURVE * normalizedDistance) / Math.log1p(PITCH_LOG_CURVE);
  return 1 - compressed;
}

function pitchAnchorForPoint(point, antenna) {
  return {
    x: antenna.x,
    y: clamp(point.y, antenna.y1, antenna.y2),
  };
}

function volumeAnchorForPoint(point, antenna) {
  return {
    x: clamp(point.x, antenna.x1, antenna.x2),
    y: antenna.y,
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

function updateSynth(pitchControl, volumeProximity, hasPitchHand, hasVolumeHand) {
  if (!audioCtx) {
    return;
  }

  const now = audioCtx.currentTime;

  if (hasPitchHand) {
    smoothedPitchControl += (pitchControl - smoothedPitchControl) * SMOOTHING;
    const frequency = mapControlToFrequency(smoothedPitchControl);
    oscillator.frequency.setTargetAtTime(frequency, now, 0.045);
    pitchEl.textContent = `${Math.round(frequency)} Hz`;
  } else {
    pitchEl.textContent = "-- Hz";
  }

  let volume = 0;
  if (hasVolumeHand) {
    smoothedVolumeProximity += (volumeProximity - smoothedVolumeProximity) * SMOOTHING;
    volume = mapProximityToVolume(smoothedVolumeProximity);
    volumeEl.textContent = `${Math.round(volume * 100)}%`;
  } else {
    volumeEl.textContent = "-- %";
  }

  if (hasPitchHand && hasVolumeHand) {
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

function drawAntennaOverlay(config) {
  const width = canvasEl.width;
  const height = canvasEl.height;

  ctx.save();
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 8]);

  const pitchX = config.pitchAntenna.x * width;
  const pitchY1 = config.pitchAntenna.y1 * height;
  const pitchY2 = config.pitchAntenna.y2 * height;

  ctx.strokeStyle = PITCH_ANTENNA_COLOR;
  ctx.shadowBlur = 14;
  ctx.shadowColor = PITCH_ANTENNA_COLOR;
  ctx.beginPath();
  ctx.moveTo(pitchX, pitchY1);
  ctx.lineTo(pitchX, pitchY2);
  ctx.stroke();

  const loopCenterX = ((config.volumeAntenna.x1 + config.volumeAntenna.x2) / 2) * width;
  const loopCenterY = config.volumeAntenna.y * height;
  const loopRadiusX = ((config.volumeAntenna.x2 - config.volumeAntenna.x1) * width) / 2;
  const loopRadiusY = Math.max(14, loopRadiusX * 0.24);

  ctx.strokeStyle = VOLUME_ANTENNA_COLOR;
  ctx.shadowColor = VOLUME_ANTENNA_COLOR;
  ctx.beginPath();
  ctx.ellipse(loopCenterX, loopCenterY, loopRadiusX, loopRadiusY, 0, 0, Math.PI * 2);
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

function buildDetections(results, config) {
  const landmarksList = results.multiHandLandmarks || [];
  const handednessList = results.multiHandedness || [];

  return landmarksList.map((landmarks, index) => {
    const indexTip = landmarks[8];
    let pitchDistance = Number.POSITIVE_INFINITY;
    let volumeDistance = Number.POSITIVE_INFINITY;

    if (indexTip) {
      const pitchAnchor = pitchAnchorForPoint(indexTip, config.pitchAntenna);
      const volumeAnchor = volumeAnchorForPoint(indexTip, config.volumeAntenna);
      pitchDistance = distance(indexTip, pitchAnchor);
      volumeDistance = distance(indexTip, volumeAnchor);
    }

    return {
      landmarks,
      indexTip,
      label: handednessLabel(handednessList[index]),
      pitchDistance,
      volumeDistance,
    };
  });
}

function assignRoleHands(detections, config) {
  let pitchHand = null;
  let volumeHand = null;
  const used = new Set();

  for (let i = 0; i < detections.length; i += 1) {
    if (detections[i].label.includes(config.pitchLabel)) {
      pitchHand = detections[i];
      used.add(i);
      break;
    }
  }

  for (let i = 0; i < detections.length; i += 1) {
    if (used.has(i)) {
      continue;
    }

    if (detections[i].label.includes(config.volumeLabel)) {
      volumeHand = detections[i];
      used.add(i);
      break;
    }
  }

  if (!pitchHand && !volumeHand && detections.length === 1) {
    const one = detections[0];
    if (one.pitchDistance <= one.volumeDistance) {
      pitchHand = one;
    } else {
      volumeHand = one;
    }
  }

  if ((!pitchHand || !volumeHand) && detections.length >= 2) {
    let bestPitch = null;
    let bestVolume = null;
    let bestCost = Number.POSITIVE_INFINITY;

    for (let i = 0; i < detections.length; i += 1) {
      for (let j = 0; j < detections.length; j += 1) {
        if (i === j) {
          continue;
        }

        const cost = detections[i].pitchDistance + detections[j].volumeDistance;
        if (cost < bestCost) {
          bestCost = cost;
          bestPitch = detections[i];
          bestVolume = detections[j];
        }
      }
    }

    if (!pitchHand) {
      pitchHand = bestPitch;
    }
    if (!volumeHand) {
      volumeHand = bestVolume;
    }
  }

  if (!pitchHand) {
    pitchHand = [...detections].sort((a, b) => a.pitchDistance - b.pitchDistance)[0] || null;
  }

  if (!volumeHand) {
    volumeHand = [...detections].sort((a, b) => a.volumeDistance - b.volumeDistance)[0] || null;
  }

  if (pitchHand && volumeHand && pitchHand === volumeHand && detections.length > 1) {
    const alternatives = detections.filter((item) => item !== pitchHand);
    const secondPitch = [...alternatives].sort((a, b) => a.pitchDistance - b.pitchDistance)[0];
    const secondVolume = [...alternatives].sort((a, b) => a.volumeDistance - b.volumeDistance)[0];

    if (secondVolume && secondVolume.volumeDistance < secondPitch.pitchDistance) {
      volumeHand = secondVolume;
    } else if (secondPitch) {
      pitchHand = secondPitch;
    }
  }

  return { pitchHand, volumeHand };
}

function drawResults(results) {
  resizeCanvas();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  const config = currentConfig();
  drawAntennaOverlay(config);

  const detections = buildDetections(results, config);
  const { pitchHand, volumeHand } = assignRoleHands(detections, config);

  let pitchControl = smoothedPitchControl;
  let volumeProximity = smoothedVolumeProximity;

  const hasPitchHand = Boolean(pitchHand?.indexTip);
  const hasVolumeHand = Boolean(volumeHand?.indexTip);

  if (pitchHand?.landmarks) {
    drawHand(pitchHand.landmarks, PITCH_HAND_COLOR);
  }

  if (hasPitchHand) {
    const pitchAnchor = pitchAnchorForPoint(pitchHand.indexTip, config.pitchAntenna);
    const pitchDistance = distance(pitchHand.indexTip, pitchAnchor);
    pitchControl = distanceToPitchControl(
      pitchDistance,
      PITCH_DISTANCE_RANGE.near,
      PITCH_DISTANCE_RANGE.far,
    );
    drawGuide(pitchHand.indexTip, pitchAnchor, PITCH_ANTENNA_COLOR);
  }

  if (volumeHand?.landmarks) {
    drawHand(volumeHand.landmarks, VOLUME_HAND_COLOR);
  }

  if (hasVolumeHand) {
    const volumeAnchor = volumeAnchorForPoint(volumeHand.indexTip, config.volumeAntenna);
    const volumeDistance = distance(volumeHand.indexTip, volumeAnchor);
    volumeProximity = inverseSquareNormalized(
      volumeDistance,
      VOLUME_DISTANCE_RANGE.near,
      VOLUME_DISTANCE_RANGE.far,
    );
    drawGuide(volumeHand.indexTip, volumeAnchor, VOLUME_ANTENNA_COLOR);
  }

  setHandState(pitchHandStateEl, hasPitchHand);
  setHandState(volumeHandStateEl, hasVolumeHand);

  setTrackingStatus(hasPitchHand, hasVolumeHand);
  updateSynth(pitchControl, volumeProximity, hasPitchHand, hasVolumeHand);
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

function onModeChange(nextMode) {
  playMode = nextMode;
  trackingStatus = "";
  updateRoleLabels();
  setStatus("Mode updated. Keep pitch hand by the vertical antenna and volume hand by the loop.");
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
    setStatus("Show both control hands in frame to play.");
  } catch (error) {
    console.error(error);
    started = false;
    startButton.disabled = false;
    setStatus("Could not start camera/audio. Check permissions and reload.");
  }
}

modeRightEl.addEventListener("change", () => {
  if (modeRightEl.checked) {
    onModeChange("right");
  }
});

modeLeftEl.addEventListener("change", () => {
  if (modeLeftEl.checked) {
    onModeChange("left");
  }
});

pitchFieldEl.addEventListener("input", () => {
  updatePitchField();
  trackingStatus = "";
});

setHandState(pitchHandStateEl, false);
setHandState(volumeHandStateEl, false);
updateRoleLabels();
updatePitchField();
startButton.addEventListener("click", start);
