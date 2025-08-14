class VoiceAssistantClient {
  constructor(serverUrl = 'ws://localhost:3001') {
    this.serverUrl = serverUrl;
    this.ws = null;
    this.isConnected = false;
    this.isRecording = false;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.audioChunks = [];
    
    // Event callbacks
    this.onConnectionReady = null;
    this.onAudioResponse = null;
    this.onError = null;
    this.onConnectionChange = null;
  }

  async connect() {
    try {
      this.ws = new WebSocket(this.serverUrl);
      
      this.ws.onopen = () => {
        console.log('Connected to voice assistant server');
        this.isConnected = true;
        if (this.onConnectionChange) {
          this.onConnectionChange(true);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleServerMessage(message);
        } catch (error) {
          console.error('Error parsing server message:', error);
        }
      };

      this.ws.onclose = () => {
        console.log('Disconnected from voice assistant server');
        this.isConnected = false;
        if (this.onConnectionChange) {
          this.onConnectionChange(false);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        if (this.onError) {
          this.onError('Connection error');
        }
      };

    } catch (error) {
      console.error('Failed to connect to server:', error);
      if (this.onError) {
        this.onError('Failed to connect to server');
      }
    }
  }

  handleServerMessage(message) {
    switch (message.type) {
      case 'connection_ready':
        console.log('AI assistant ready');
        if (this.onConnectionReady) {
          this.onConnectionReady();
        }
        break;
        
      case 'audio_response':
        if (this.onAudioResponse) {
          this.onAudioResponse(message.data);
        }
        break;
        
      case 'error':
        console.error('Server error:', message.message);
        if (this.onError) {
          this.onError(message.message);
        }
        break;
        
      default:
        console.log('Unknown message type:', message.type);
    }
  }

  async startRecording() {
    if (!this.isConnected || this.isRecording) {
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });

      this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 16000
      });

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        await this.sendAudioToServer(audioBlob);
        this.audioChunks = [];
      };

      this.mediaRecorder.start(100); // Collect data every 100ms
      this.isRecording = true;
      
      return true;
    } catch (error) {
      console.error('Failed to start recording:', error);
      if (this.onError) {
        this.onError('Failed to access microphone');
      }
      return false;
    }
  }

  stopRecording() {
    if (this.isRecording && this.mediaRecorder) {
      this.mediaRecorder.stop();
      this.isRecording = false;
      
      // Stop all audio tracks
      if (this.mediaRecorder.stream) {
        this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
    }
  }

  async sendAudioToServer(audioBlob) {
    if (!this.isConnected) return;

    try {
      // Convert blob to base64 for WebSocket transmission
      const arrayBuffer = await audioBlob.arrayBuffer();
      const base64Audio = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
      
      const message = {
        type: 'audio_input',
        audio: base64Audio,
        mimeType: 'audio/webm'
      };

      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('Failed to send audio:', error);
    }
  }

  interrupt() {
    if (this.isConnected) {
      const message = { type: 'interrupt' };
      this.ws.send(JSON.stringify(message));
    }
  }

  startConversation() {
    if (this.isConnected) {
      const message = { type: 'start_conversation' };
      this.ws.send(JSON.stringify(message));
    }
  }

  async playAudioResponse(audioData) {
    try {
      if (!audioData.inlineData || !audioData.inlineData.data) {
        console.error('Invalid audio data format');
        return;
      }

      // Decode base64 audio data
      const audioBytes = atob(audioData.inlineData.data);
      const audioBuffer = new Uint8Array(audioBytes.length);
      
      for (let i = 0; i < audioBytes.length; i++) {
        audioBuffer[i] = audioBytes.charCodeAt(i);
      }

      // Create audio context if not exists
      if (!this.audioContext) {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      // Decode and play audio
      const decodedAudio = await this.audioContext.decodeAudioData(audioBuffer.buffer);
      const source = this.audioContext.createBufferSource();
      source.buffer = decodedAudio;
      source.connect(this.audioContext.destination);
      source.start();

    } catch (error) {
      console.error('Failed to play audio response:', error);
    }
  }

  disconnect() {
    this.isRecording = false;
    
    if (this.mediaRecorder) {
      this.mediaRecorder.stop();
    }
    
    if (this.ws) {
      this.ws.close();
    }
    
    this.isConnected = false;
  }
}

export default VoiceAssistantClient;