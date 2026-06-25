import { io, Socket } from 'socket.io-client';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

class SocketService {
  private socket: Socket | null = null;

  connect() {
    if (!this.socket) {
      // Remove '/api' from the end of the base URL if it exists, as Socket.IO expects the root server URL
      const serverUrl = API_BASE.replace(/\/api$/, '');
      this.socket = io(serverUrl, {
        reconnectionDelayMax: 10000,
        transports: ['websocket', 'polling']
      });

      this.socket.on('connect', () => {
        console.log('[Socket.IO] Connected to server');
      });

      this.socket.on('disconnect', () => {
        console.log('[Socket.IO] Disconnected from server');
      });
    }
    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket() {
    return this.socket;
  }
}

export const socketService = new SocketService();
