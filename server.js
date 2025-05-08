const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "https://win-star-drop.vercel.app/", // В продакшене замените на ваш домен
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Хранилище данных
const rooms = {}; // { roomId: { players: [], gameState: {} } }
const players = {}; // { socketId: { name, roomId, ... } }

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Обработка входа в комнату
  socket.on('joinRoom', ({ roomId, playerName, playerData }) => {
    // Логика добавления игрока в комнату
  });

  // Обработка ходов в игре "Монета"
  socket.on('coinAction', ({ action, roomId, data }) => {
    // Логика обработки действий с монетой
  });

  // Обработка отключения
  socket.on('disconnect', () => {
    // Логика удаления игрока из комнаты
  });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
