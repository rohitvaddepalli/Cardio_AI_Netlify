const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const canvas = document.getElementById('oscilloscope');
const ctx = canvas.getContext('2d');
const resultsArea = document.getElementById('resultsArea');
const loading = document.getElementById('loading');
const bpmValue = document.getElementById('bpmValue');
const statusValue = document.getElementById('statusValue');
const variationValue = document.getElementById('variationValue');
const recordingStatus = document.getElementById('recordingStatus');

let audioContext;
let mediaStream;
let source;
let analyser;
let scriptNode;
let audioChunks = [];
let isRecording = false;
let animationId;
let countdownInterval;

// Resize canvas
function resizeCanvas() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

startBtn.addEventListener('click', async () => {
    try {
        if (!navigator.mediaDevices) {
            alert('Audio recording is not supported in this browser.');
            return;
        }

        // IMPORTANT: Request raw audio. Phones try to "clean" audio for speech, 
        // which removes low-frequency heart sounds. We must disable all those features.
        const constraints = {
            audio: {
                echoCancellation: false,
                autoGainControl: false,
                noiseSuppression: false,
                channelCount: 1
            }
        };
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        source = audioContext.createMediaStreamSource(mediaStream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;

        // Use ScriptProcessor for simple raw audio capture implementation
        scriptNode = audioContext.createScriptProcessor(4096, 1, 1);

        source.connect(analyser);
        analyser.connect(scriptNode);
        scriptNode.connect(audioContext.destination);

        audioChunks = [];
        isRecording = true;

        scriptNode.onaudioprocess = (e) => {
            if (!isRecording) return;
            const inputData = e.inputBuffer.getChannelData(0);
            audioChunks.push(new Float32Array(inputData));
        };

        // UI Updates
        startBtn.disabled = true;
        stopBtn.disabled = false;
        resultsArea.style.display = 'none';

        // 30 Seconds Countdown Logic
        let timeLeft = 30;
        recordingStatus.textContent = `Recording... ${timeLeft}s`;
        recordingStatus.style.color = '#ff0055';

        countdownInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft > 0) {
                recordingStatus.textContent = `Recording... ${timeLeft}s`;
            } else {
                // Auto-stop when time is up
                stopRecording();
            }
        }, 1000);

        drawVisualizer();

    } catch (err) {
        console.error('Error accessing microphone:', err);
        alert('Could not access microphone. Please allow permissions.');
    }
});

// Refactored Stop Function to be called either by button or timer
async function stopRecording() {
    if (!isRecording) return;

    // Clear the timer
    clearInterval(countdownInterval);

    isRecording = false;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    recordingStatus.textContent = 'Processing...';
    recordingStatus.style.color = '#e0e0e0';

    // Stop tracks
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }

    // Disconnect nodes
    if (source) source.disconnect();
    if (analyser) analyser.disconnect();
    if (scriptNode) scriptNode.disconnect();
    cancelAnimationFrame(animationId);

    // Prepare WAV
    if (audioContext && audioChunks.length > 0) {
        const wavBlob = exportWAV(audioChunks, audioContext.sampleRate);
        // Send to backend
        await sendAudioToBackend(wavBlob);
    } else {
        alert("Recording failed or was empty.");
        recordingStatus.textContent = 'Ready to Record';
    }
}

stopBtn.addEventListener('click', stopRecording);

function drawVisualizer() {
    if (!isRecording) return;

    animationId = requestAnimationFrame(drawVisualizer);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    ctx.fillStyle = 'rgba(15, 17, 26, 0.2)'; // Fade out effect
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#00f3ff';
    ctx.beginPath();

    const sliceWidth = canvas.width * 1.0 / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }

        x += sliceWidth;
    }

    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
}

function mergeBuffers(bufferArray, length) {
    const result = new Float32Array(length);
    let offset = 0;
    for (let i = 0; i < bufferArray.length; i++) {
        result.set(bufferArray[i], offset);
        offset += bufferArray[i].length;
    }
    return result;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function exportWAV(chunks, sampleRate) {
    const totalLength = chunks.reduce((acc, curr) => acc + curr.length, 0);
    const audioData = mergeBuffers(chunks, totalLength);

    const buffer = new ArrayBuffer(44 + audioData.length * 2);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + audioData.length * 2, true);
    writeString(view, 8, 'WAVE');

    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);

    writeString(view, 36, 'data');
    view.setUint32(40, audioData.length * 2, true);

    let offset = 44;
    for (let i = 0; i < audioData.length; i++) {
        let s = Math.max(-1, Math.min(1, audioData[i]));
        s = s < 0 ? s * 0x8000 : s * 0x7FFF;
        view.setInt16(offset, s, true);
        offset += 2;
    }

    return new Blob([view], { type: 'audio/wav' });
}

async function sendAudioToBackend(blob) {
    loading.style.display = 'flex';
    resultsArea.style.display = 'none';

    const formData = new FormData();
    formData.append('audio', blob, 'heartbeat.wav');

    try {
        const response = await fetch('/analyze', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();

        loading.style.display = 'none';

        if (response.ok) {
            resultsArea.style.display = 'grid';
            bpmValue.textContent = result.bpm;
            statusValue.textContent = result.status;

            if (result.status === 'Irregular') {
                statusValue.style.color = '#ff0055';
            } else {
                statusValue.style.color = '#00f3ff';
            }

            variationValue.textContent = `Interval Variation: ${result.variation}%`;
            recordingStatus.textContent = 'Analysis Complete';
        } else {
            alert('Analysis Error: ' + (result.error || 'Unknown error'));
            recordingStatus.textContent = 'Error';
        }

    } catch (err) {
        loading.style.display = 'none';
        console.error('Upload error:', err);
        alert('Failed to connect to server.');
        recordingStatus.textContent = 'Connection Error';
    }
}
