const express = require('express');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const http = require('http');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store active connections
const activeConnections = new Map();

// Gemini Live API WebSocket URL
const GEMINI_WS_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerationService/BidiGenerateContent';

// System instructions for Revolt Motors
const SYSTEM_INSTRUCTIONS = {
  parts: [
    {
      text: `You are Rev, the voice assistant for Revolt Motors, India's leading electric motorcycle company. 

Key information about Revolt Motors:
- Founded in 2019 by Rahul Sharma
- Pioneered AI-enabled electric motorcycles in India
- Main products: RV400 and RV300 electric motorcycles
- Features: Smart connectivity, mobile app integration, swappable batteries
- Presence in major Indian cities
- Focus on sustainable mobility and innovation

Guidelines:
- Always be enthusiastic about electric mobility and Revolt Motors
- Provide helpful information about Revolt's products, services, and electric motorcycles
- If asked about competitors, politely redirect to Revolt's advantages
- Be conversational, friendly, and knowledgeable
- If you don't know specific current details, acknowledge it and suggest contacting Revolt directly
- Support multiple languages if the user speaks in Hindi or other Indian languages
- Keep responses concise and engaging for voice interaction`
    }
  ]
};

class GeminiLiveConnection {
  constructor(clientWs) {
    this.clientWs = clientWs;
    this.geminiWs = null;
    this.isConnected = false;
    this.connect();
  }

  async connect() {
    try {
      const url = `${GEMINI_WS_URL}?key=${process.env.GEMINI_API_KEY}`;
      this.geminiWs = new WebSocket(url);

      this.geminiWs.on('open', () => {
        console.log('Connected to Gemini Live API');
        this.isConnected = true;
        
        // Send initial setup message
        const setupMessage = {
          setup: {
            model: process.env.GEMINI_MODEL || 'models/gemini-2.0-flash-live-001',
            generation_config: {
              response_modalities: ['AUDIO'],
              speech_config: {
                voice_config: {
                  prebuilt_voice_config: {
                    voice_name: 'Aoede'
                  }
                }
              }
            },
            system_instruction: SYSTEM_INSTRUCTIONS
          }
        };

        this.geminiWs.send(JSON.stringify(setupMessage));
        
        // Notify client that connection is ready
        this.clientWs.send(JSON.stringify({
          type: 'connection_ready'
        }));
      });

      this.geminiWs.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          
          // Handle different message types from Gemini
          if (message.setupComplete) {
            console.log('Gemini setup complete');
          } else if (message.serverContent) {
            // Look for audio content in the response
            if (message.serverContent.parts) {
              const audioPart = message.serverContent.parts.find(
                part => part.inline_data && part.inline_data.mime_type && part.inline_data.mime_type.startsWith('audio/')
              );
              
              if (audioPart) {
                // Forward audio response to client
                this.clientWs.send(JSON.stringify({
                  type: 'audio_response',
                  data: audioPart
                }));
              }
            }
            
            // Also forward the entire serverContent for compatibility
            this.clientWs.send(JSON.stringify({
              type: 'server_content',
              data: message.serverContent
            }));
          } else if (message.toolCallCancellation) {
            console.log('Tool call cancelled');
          }
        } catch (error) {
          console.error('Error parsing Gemini message:', error);
        }
      });

      this.geminiWs.on('error', (error) => {
        console.error('Gemini WebSocket error:', error);
        this.clientWs.send(JSON.stringify({
          type: 'error',
          message: 'Connection to AI service failed'
        }));
      });

      this.geminiWs.on('close', () => {
        console.log('Gemini WebSocket closed');
        this.isConnected = false;
        // Optionally attempt reconnection here
      });

    } catch (error) {
      console.error('Failed to setup Gemini connection:', error);
      this.clientWs.send(JSON.stringify({
        type: 'error',
        message: 'Failed to initialize AI connection'
      }));
    }
  }

  // Support for chunked audio (new approach)
  sendAudioChunk(audioBase64, mimeType = 'audio/pcm', isFinal = true) {
    if (!this.isConnected || !this.geminiWs) {
      console.warn('Cannot send audio: Gemini not connected');
      return;
    }

    const message = {
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{
            inline_data: {
              mime_type: mimeType,
              data: audioBase64
            }
          }]
        }],
        turn_complete: isFinal
      }
    };
    
    this.geminiWs.send(JSON.stringify(message));
  }

  // Support for legacy audio sending (original approach)
  sendAudioToGemini(audioData) {
    this.sendAudioChunk(audioData, 'audio/pcm', true);
  }

  sendInterruption() {
    if (this.isConnected && this.geminiWs) {
      const message = {
        clientContent: {
          turns: [{
            role: 'user',
            parts: [{
              text: ''
            }]
          }],
          turn_complete: false
        }
      };
      
      this.geminiWs.send(JSON.stringify(message));
    }
  }

  close() {
    if (this.geminiWs) {
      this.geminiWs.close();
      this.geminiWs = null;
    }
    this.isConnected = false;
  }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('New client connected');
  
  const connectionId = Date.now().toString();
  const geminiConnection = new GeminiLiveConnection(ws);
  activeConnections.set(connectionId, geminiConnection);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      switch (data.type) {
        case 'audio_input':
          // Legacy support - forward audio to Gemini
          geminiConnection.sendAudioToGemini(data.audio);
          break;

        case 'audio_chunk':
          // New chunked audio approach
          geminiConnection.sendAudioChunk(
            data.audio, 
            data.mimeType || 'audio/pcm', 
            data.final !== false
          );
          break;
          
        case 'interrupt':
          // Handle user interruption
          geminiConnection.sendInterruption();
          break;
          
        case 'start_conversation':
          // Initialize conversation if needed
          console.log('Starting conversation for connection:', connectionId);
          break;
          
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('Error handling client message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected:', connectionId);
    geminiConnection.close();
    activeConnections.delete(connectionId);
  });

  ws.on('error', (error) => {
    console.error('Client WebSocket error:', error);
    geminiConnection.close();
    activeConnections.delete(connectionId);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    connections: activeConnections.size,
    timestamp: new Date().toISOString()
  });
});

// API info endpoint
app.get('/api/info', (req, res) => {
  res.json({
    name: 'Revolt Motors Voice Assistant API',
    version: '1.0.0',
    model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-live-001',
    features: ['real-time-audio', 'interruptions', 'multi-language', 'chunked-audio']
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Revolt Motors Voice Assistant Server running on port ${PORT}`);
  console.log(`WebSocket server ready for connections`);
  console.log(`Model: ${process.env.GEMINI_MODEL || 'gemini-2.0-flash-live-001'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});