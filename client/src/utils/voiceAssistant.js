class VoiceAssistantClient {
  constructor(serverUrl = 'ws://localhost:3001') {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.isConnected = false;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioContext = null;

    this.onConnectionReady = null;
    this.onAudioResponse = null;
    this.onError = null;
    this.onConnectionChange = null;
  }

  connect() {
    this.ws = new WebSocket(this.serverUrl);

    this.ws.onopen = () => {
      this.isConnected = true;
      this.onConnectionChange?.(true);
      console.log("Connected to backend");
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'connection_ready') {
          this.onConnectionReady?.();
        } else if (message.type === 'audio_response') {
          this.onAudioResponse?.(message.data);
        } else if (message.type === 'error') {
          this.onError?.(message.message);
        }
      } catch (err) {
        console.error("Error parsing message:", err);
      }
    };
this.ws.onclose = () => {
      this.isConnected = false;
      this.onConnectionChange?.(false);
    };

    this.ws.onerror = (err) => {
      console.error("WebSocket error:", err);
      this.onError?.("WebSocket error");
    };
  }

  async startRecording() {
    if (!this.isConnected || this.isRecording) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1 }
      });

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.sendAudioChunk(event.data, false); // send live chunk
        }
      };

      this.mediaRecorder.onstop = () => {
        // Final empty chunk to mark end of turn
        this.sendAudioChunk(new Blob(), true);
        stream.getTracks().forEach(track => track.stop());
      };
this.mediaRecorder.start(100); // send every 100ms
      this.isRecording = true;

    } catch (err) {
      console.error("Mic error:", err);
      this.onError?.("Microphone access failed");
    }
  }

  stopRecording() {
    if (this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
    }
  }

  async sendAudioChunk(blob, isFinal) {
    if (!this.ws  this.ws.readyState !== WebSocket.OPEN) return;

    const arrayBuffer = await blob.arrayBuffer();
    const base64Audio = this.arrayBufferToBase64(arrayBuffer);

    this.ws.send(JSON.stringify({
      type: 'audio_chunk',
      audio: base64Audio,
      final: isFinal,
      mimeType: 'audio/webm;codecs=opus'
    }));
  }

  arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  playAudioResponse(audioData) {
    if (!audioData?.inline_data?.data) return;
    const audioBytes = atob(audioData.inline_data.data);
    const audioBuffer = new Uint8Array(audioBytes.length);
    for (let i = 0; i < audioBytes.length; i++) {
      audioBuffer[i] = audioBytes.charCodeAt(i);
    }

    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext  window.webkitAudioContext)();
    }

    this.audioContext.decodeAudioData(audioBuffer.buffer, (decoded) => {
      const source = this.audioContext.createBufferSource();
      source.buffer = decoded;
      source.connect(this.audioContext.destination);
      source.start();
    });
  }
}

export default VoiceAssistantClient;