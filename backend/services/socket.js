const { Server } = require('socket.io');

let io;

function initSocket(server) {
  const allowed = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
  
  io = new Server(server, {
    cors: {
      origin: allowed.includes('*') ? '*' : allowed,
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`[Socket.IO] Client connected: ${socket.id}`);
    
    socket.on('disconnect', () => {
      console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getIo() {
  if (!io) {
    throw new Error('Socket.IO is not initialized');
  }
  return io;
}

/**
 * Broadcast an event to all connected clients
 * @param {string} eventName 
 * @param {any} data 
 */
function broadcast(eventName, data) {
  if (io) {
    io.emit(eventName, data);
  }
}

module.exports = {
  initSocket,
  getIo,
  broadcast
};
