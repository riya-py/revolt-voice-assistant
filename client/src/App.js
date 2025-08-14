import React, { useState, useEffect, useRef } from 'react';
import './App.css';

const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState(null);
  
  const wsRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const audioChunksRef = useRef([]);

  // WebSocket connection
  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      stopRecording();
    };
  }, []);

  const connectWebSocket = () => {
    try {
      // FIXED: Changed port from 8080 to 3001 to match server
      wsRef.current = new WebSocket('ws://localhost:3001');
      
      wsRef.current.onopen = () => {
        setIsConnected(true);
        setError(null);
        console.log('Connected to voice assistant');
        
        // Initialize session
        wsRef.current.send(JSON.stringify({
          type: 'start_conversation'
        }));
      };

      wsRef.current.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        console.log('Disconnected from voice assistant');
        // Auto-reconnect after 3 seconds
        setTimeout(() => {
          if (!isConnected) {
            connectWebSocket();
          }
        }, 3000);
      };

      wsRef.current.onerror = (error) => {
        setError('Connection failed. Make sure the server is running on port 3001.');
        console.error('WebSocket error:', error);
      };

    } catch (error) {
      setError('Failed to connect to server');
    }
  };

  const handleWebSocketMessage = (data) => {
    switch (data.type) {
      case 'connection_ready':
        console.log('Connection ready');
        break;
        
      case 'audio_response':
        // Handle audio response from Gemini
        if (data.data && data.data.inline_data) {
          // Play the audio response
          playAudioResponse(data.data.inline_data.data);
        }
        setIsProcessing(false);
        break;
        
      case 'server_content':
        // Handle text responses if any
        if (data.data && data.data.parts) {
          const textPart = data.data.parts.find(part => part.text);
          if (textPart) {
            setMessages(prev => [...prev, {
              type: 'ai',
              text: textPart.text,
              timestamp: Date.now()
            }]);
            speakText(textPart.text);
          }
        }
        setIsProcessing(false);
        break;
        
      case 'error':
        setError(data.message);
        setIsProcessing(false);
        break;
        
      default:
        console.log('Unknown message type:', data.type);
    }
  };

  const playAudioResponse = (base64Audio) => {
    try {
      // Convert base64 to audio and play
      const audioData = atob(base64Audio);
      const audioArray = new Uint8Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        audioArray[i] = audioData.charCodeAt(i);
      }
      
      const audioBlob = new Blob([audioArray], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      audio.play().then(() => {
        console.log('Playing AI audio response');
      }).catch(error => {
        console.error('Error playing audio:', error);
        // Fallback to text-to-speech if audio playback fails
      });
      
      // Cleanup
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
      };
      
    } catch (error) {
      console.error('Error processing audio response:', error);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        } 
      });
      
      streamRef.current = stream;
      audioChunksRef.current = [];

      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { 
          type: 'audio/webm;codecs=opus' 
        });
        sendAudioToServer(audioBlob);
      };

      mediaRecorderRef.current.start();
      setIsListening(true);
      setError(null);
      
    } catch (error) {
      setError('Microphone access denied or not available');
      console.error('Recording error:', error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isListening) {
      mediaRecorderRef.current.stop();
      setIsListening(false);
      setIsProcessing(true);
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const sendAudioToServer = async (audioBlob) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Not connected to server');
      setIsProcessing(false);
      return;
    }

    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64Audio = reader.result.split(',')[1];
        
        wsRef.current.send(JSON.stringify({
          type: 'audio_chunk',
          audio: base64Audio,
          mimeType: 'audio/webm',
          final: true
        }));

        // Add user message to chat
        setMessages(prev => [...prev, {
          type: 'user',
          text: '🎤 Voice message sent...',
          timestamp: Date.now()
        }]);
      };
      
      reader.readAsDataURL(audioBlob);
    } catch (error) {
      setError('Failed to send audio');
      setIsProcessing(false);
      console.error('Audio send error:', error);
    }
  };

  const speakText = (text) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.9;
      utterance.pitch = 1;
      utterance.volume = 0.8;
      
      // Find a good voice
      const voices = speechSynthesis.getVoices();
      const preferredVoice = voices.find(voice => 
        voice.name.includes('Google') || voice.name.includes('Natural')
      ) || voices[0];
      
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
      
      speechSynthesis.speak(utterance);
    }
  };

  const interruptAI = () => {
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
    }
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'interrupt'
      }));
    }
  };

  const toggleRecording = () => {
    if (!isConnected) {
      setError('Not connected to server. Trying to reconnect...');
      connectWebSocket();
      return;
    }

    if (isListening) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo">
          <span className="revolt-text">REVOLT</span>
        </div>
        <div className="connection-status">
          <div className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`}></div>
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      {/* Main Interface */}
      <main className="main-content">
        <div className="chat-interface">
          <div className="assistant-header">
            <div className="robot-avatar">
              <div className="robot-head">
                <div className="robot-eyes">
                  <div className="eye left-eye"></div>
                  <div className="eye right-eye"></div>
                </div>
                <div className="robot-mouth"></div>
              </div>
            </div>
            <h1 className="title">Chat with Rev</h1>
            <p className="subtitle">Your Revolt Motors Voice Assistant</p>
          </div>

          {/* Error Display */}
          {error && (
            <div className="error-message">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="close-error">×</button>
            </div>
          )}

          {/* Messages */}
          <div className="messages-container">
            {messages.length === 0 ? (
              <div className="welcome-message">
                <p>Hi! I'm Rev, your Revolt Motors assistant.</p>
                <p>You can ask me about anything.</p>
              </div>
            ) : (
              <div className="messages">
                {messages.map((message, index) => (
                  <div key={index} className={`message ${message.type}`}>
                    <div className="message-content">
                      <span>{message.text}</span>
                    </div>
                    <div className="message-time">
                      {new Date(message.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Voice Controls */}
          <div className="voice-controls">
            <button
              className={`mic-button ${isListening ? 'listening' : ''} ${isProcessing ? 'processing' : ''} ${!isConnected ? 'disabled' : ''}`}
              onClick={toggleRecording}
              disabled={isProcessing}
            >
              <div className="mic-icon">
                {!isConnected ? '❌' : isListening ? '🔴' : isProcessing ? '⏳' : '🎤'}
              </div>
              <div className="mic-status">
                {!isConnected ? 'Disconnected' : isListening ? 'Listening...' : isProcessing ? 'Processing...' : 'Tap to speak'}
              </div>
            </button>

            {speechSynthesis.speaking && (
              <button className="interrupt-button" onClick={interruptAI}>
                Stop Speaking
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="footer">
        <p>Powered by Revolt Motors & Gemini AI</p>
      </footer>
    </div>
  );
};

export default App;