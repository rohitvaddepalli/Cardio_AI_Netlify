import os
import numpy as np
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from scipy.io import wavfile
from scipy.signal import butter, sosfilt, decimate, find_peaks, hilbert

app = Flask(__name__)
CORS(app) # Enable CORS for all routes (allows cross-origin requests if you host frontend separately)

# Ensure the uploads directory exists
import tempfile

# Ensure the uploads directory exists
UPLOAD_FOLDER = os.path.join(tempfile.gettempdir(), 'uploads')
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

def analyze_heart_signal(filepath):
    try:
        # 1. Load the audio file
        samplerate, data = wavfile.read(filepath)
        
        # If stereo, convert to mono
        if len(data.shape) > 1:
            data = data.mean(axis=1)
            
        # Normalize data
        data = data / np.max(np.abs(data))

        # 2. Downsample to approx 2000Hz
        # We calculate the decimation factor
        target_fs = 2000
        decimation_factor = int(samplerate / target_fs)
        if decimation_factor > 1:
            data = decimate(data, decimation_factor)
            fs = samplerate / decimation_factor
        else:
            fs = samplerate

        # 3. Bandpass Filter (20Hz - 150Hz)
        lowcut = 20.0
        highcut = 150.0
        sos = butter(4, [lowcut, highcut], btype='band', fs=fs, output='sos')
        filtered_data = sosfilt(sos, data)

        # 4. Envelope Extraction (Hilbert transform for smoothing)
        analytic_signal = hilbert(filtered_data)
        amplitude_envelope = np.abs(analytic_signal)
        
        # Smooth the envelope further with a moving average to reduce noise
        # Window size of 0.05 seconds
        window_size = int(0.05 * fs) 
        amplitude_envelope = np.convolve(amplitude_envelope, np.ones(window_size)/window_size, mode='same')

        # 5. Peak Detection
        # Minimum distance between peaks: assuming max 200 BPM -> 3.33 beats/sec -> 0.3s between beats
        min_distance = int(0.3 * fs) 
        # Height threshold relative to the max signal
        height_threshold = 0.3 * np.max(amplitude_envelope)
        
        peaks, _ = find_peaks(amplitude_envelope, distance=min_distance, height=height_threshold)

        # 6. Analysis Logic
        if len(peaks) < 2:
            return {
                "bpm": 0,
                "status": "Inconclusive (No beats detected)",
                "intervals_std_percent": 0
            }

        # Calculate BPM
        duration_seconds = len(data) / fs
        bpm = (len(peaks) / duration_seconds) * 60

        # Calculate Rhythm Status
        peak_times = peaks / fs
        intervals = np.diff(peak_times)
        
        if len(intervals) > 0:
            mean_interval = np.mean(intervals)
            std_interval = np.std(intervals)
            variation_percent = (std_interval / mean_interval) * 100
        else:
            variation_percent = 0

        status = "Regular"
        if variation_percent > 15:
            status = "Irregular"

        return {
            "bpm": round(bpm, 1),
            "status": status,
            "variation": round(variation_percent, 2)
        }

    except Exception as e:
        print(f"Error processing file: {e}")
        return None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/health')
def health():
    # Lightweight endpoint for keep-alive pings
    return jsonify({"status": "awake"}), 200

@app.route('/analyze', methods=['POST'])
def analyze():
    if 'audio' not in request.files:
        return jsonify({"error": "No audio file provided"}), 400
    
    file = request.files['audio']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    if file:
        filepath = os.path.join(UPLOAD_FOLDER, 'temp_recording.wav')
        file.save(filepath)
        
        result = analyze_heart_signal(filepath)
        
        # Clean up
        try:
            os.remove(filepath)
        except:
            pass

        if result:
            return jsonify(result)
        else:
            return jsonify({"error": "Analysis failed"}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
