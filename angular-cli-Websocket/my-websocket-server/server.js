import { Server } from 'ws';
const server = new Server({ port: 3050, path: '/ng-cli-ws' });

server.on('connection', (ws) => {
  console.log('New client connected');
  
  ws.on('message', (message) => {
    console.log('Received message:', message);
    ws.send(`Server received: ${message}`);
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

console.log('WebSocket server is running on ws://192.168.0.140:3050/ng-cli-ws');
