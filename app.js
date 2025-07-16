// === app.js ===
const videoElement = document.getElementById("video");
const canvasElement = document.getElementById("output");
const canvasCtx = canvasElement.getContext("2d");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const zoomText = document.getElementById("zoomText");
const distanceText = document.getElementById("distanceText");
const angleText = document.getElementById("angleText");
const zoomIndicator = document.getElementById("zoomIndicator");
const emotionLabel = document.getElementById("emotionLabel");
const videoRecorderLabel = document.getElementById("videoRecorderLabel");

let currentZoom = 1.0;
let angle = 0;
let camera;
let stream;
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];

const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});
hands.setOptions({
  maxNumHands: 2,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
});

const faceMesh = new FaceMesh({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
});
faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7,
});

let lastBlinkTime = 0;
function getEAR(lm, t, b, l, r) {
  const vertical = Math.hypot(lm[t].x - lm[b].x, lm[t].y - lm[b].y);
  const horizontal = Math.hypot(lm[l].x - lm[r].x, lm[l].y - lm[r].y);
  return vertical / horizontal;
}

function saveSnapshot() {
  const link = document.createElement("a");
  link.download = `snapshot_${Date.now()}.png`;
  link.href = canvasElement.toDataURL("image/png");
  link.click();
}

function startRecording() {
  recordedChunks = [];
  const streamOut = canvasElement.captureStream();
  mediaRecorder = new MediaRecorder(streamOut);
  mediaRecorder.ondataavailable = (e) => recordedChunks.push(e.data);
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording_${Date.now()}.webm`;
    a.click();
  };
  mediaRecorder.start();
  isRecording = true;
  videoRecorderLabel.style.display = "block";
}

function stopRecording() {
  if (isRecording) {
    mediaRecorder.stop();
    isRecording = false;
    videoRecorderLabel.style.display = "none";
  }
}

function detectVictoryGesture(landmarks) {
  const indexExtended = landmarks[8].y < landmarks[6].y;
  const middleExtended = landmarks[12].y < landmarks[10].y;
  const othersFolded =
    landmarks[16].y > landmarks[14].y &&
    landmarks[20].y > landmarks[18].y &&
    landmarks[4].y > landmarks[3].y;
  return indexExtended && middleExtended && othersFolded;
}

function processFaceMesh(results) {
  if (results.multiFaceLandmarks?.length) {
    const lm = results.multiFaceLandmarks[0];
    const leftEAR = getEAR(lm, 386, 374, 263, 362);
    const rightEAR = getEAR(lm, 159, 145, 133, 33);
    const avgEAR = (leftEAR + rightEAR) / 2;
    const now = Date.now();
    if (avgEAR < 0.2 && now - lastBlinkTime > 2000) {
      lastBlinkTime = now;
      saveSnapshot();
    }
  }
  detectEmotion();
}

let prevAngle = null;
let rotationZoom = 1.0;
function calculateAngle(p1, p2) {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.atan2(dy, dx) * (180 / Math.PI);
}

function processHands(results) {
  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;

  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(
    results.image,
    0,
    0,
    canvasElement.width,
    canvasElement.height
  );
  zoomIndicator.style.display = "none";

  if (results.multiHandLandmarks.length === 2) {
    const [hand1, hand2] = results.multiHandLandmarks;
    const dx = (hand1[0].x - hand2[0].x) * canvasElement.width;
    const dy = (hand1[0].y - hand2[0].y) * canvasElement.height;
    const distance = Math.sqrt(dx * dx + dy * dy);
    let zoom = Math.max(1, Math.min(distance / 150, 3));
    currentZoom = zoom;
    canvasElement.style.transform = `scale(${zoom})`;
    zoomText.innerText = `${zoom.toFixed(1)}x`;
    distanceText.innerText = `${(distance / 100).toFixed(1)}m`;
    prevAngle = null;
  } else if (results.multiHandLandmarks.length === 1) {
    const hand = results.multiHandLandmarks[0];
    const wrist = hand[0],
      indexBase = hand[5];
    const angleNow = calculateAngle(wrist, indexBase);
    if (prevAngle !== null) {
      let diff = angleNow - prevAngle;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      if (Math.abs(diff) > 5) {
        rotationZoom += diff * 0.01;
        rotationZoom = Math.max(1, Math.min(rotationZoom, 3));
        zoomIndicator.style.display = "block";
      }
      canvasElement.style.transform = `scale(${rotationZoom})`;
      zoomText.innerText = `${rotationZoom.toFixed(1)}x`;
      distanceText.innerText = `${rotationZoom.toFixed(1)}x`;
    }
    prevAngle = angleNow;

    // ✌️ Gesture detection to start recording
    if (detectVictoryGesture(hand) && !isRecording) {
      startRecording();
    }
  } else {
    currentZoom = 1.0;
    rotationZoom = 1.0;
    prevAngle = null;
    canvasElement.style.transform = "scale(1)";
    zoomText.innerText = "1.0x";
    distanceText.innerText = "1.0m";
  }

  for (const lm of results.multiHandLandmarks) {
    drawConnectors(canvasCtx, lm, HAND_CONNECTIONS, {
      color: "#fff",
      lineWidth: 1,
    });
  }
  canvasCtx.restore();
}

function updateHUD() {
  angle = (angle + 2) % 360;
  angleText.innerText = `${angle}°`;
  requestAnimationFrame(updateHUD);
}
updateHUD();

// Voice Command
const recognition = new (window.SpeechRecognition ||
  window.webkitSpeechRecognition)();
recognition.continuous = true;
recognition.lang = "en-US";
recognition.onresult = (event) => {
  const command = event.results[event.results.length - 1][0].transcript
    .trim()
    .toLowerCase();
    if (command.includes("start camera")) startBtn.click();
    if (command.includes("save picture")) saveSnapshot();
  if (command.includes("zoom")) {
    currentZoom = Math.min(currentZoom + 0.1, 3);
    canvasElement.style.transform = `scale(${currentZoom})`;
  }
};
recognition.start();

async function detectEmotion() {
  const detection = await faceapi
    .detectSingleFace(videoElement, new faceapi.TinyFaceDetectorOptions())
    .withFaceExpressions();
  if (detection && detection.expressions) {
    const exp = detection.expressions;
    const maxExp = Object.keys(exp).reduce((a, b) => (exp[a] > exp[b] ? a : b));
    const emojiMap = {
      happy: "😊 Happy",
      angry: "😡 Angry",
      neutral: "😐 Neutral",
      sad: "😢 Sad",
      surprised: "😲 Surprise",
    };
    emotionLabel.innerText = emojiMap[maxExp] || "😐 Neutral";
  }
}

hands.onResults(processHands);
faceMesh.onResults(processFaceMesh);

startBtn.onclick = async () => {
  stream = await navigator.mediaDevices.getUserMedia({ video: true });
  videoElement.srcObject = stream;
  camera = new Camera(videoElement, {
    onFrame: async () => {
      await faceMesh.send({ image: videoElement });
      await hands.send({ image: videoElement });
    },
    width: 640,
    height: 440,
  });
  camera.start();
};

stopBtn.onclick = () => {
  alert("rostan ham o'chirasanmi");
  stopRecording();
  if (camera) camera.stop();
  if (stream) stream.getTracks().forEach((track) => track.stop());
};
