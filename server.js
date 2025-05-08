// Добавьте в начало server.js
const { Server } = require('socket.io');
const { createServer } = require('http');

const app = express();
const server = createServer(app);

require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');


// Настройка CORS и Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*", // Для теста разрешите все источники (в продакшене укажите ваш домен)
    methods: ["GET", "POST"],
  },
  transports: ["websocket", "polling"], // Явно указываем transports
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Хранилище данных
const rooms = new Map(); // roomId -> roomData
const players = new Map(); // socketId -> playerData
const activeGames = new Map(); // gameId -> gameData

// Генерация ID комнаты
function generateRoomId() {
  return Math.random().toString(36).substr(2, 8).toUpperCase();
}

// Обработка подключений
io.on('connection', (socket) => {
  console.log(`Новое подключение: ${socket.id}`);

  // Инициализация игрока
  players.set(socket.id, {
    id: socket.id,
    name: `Игрок-${Math.floor(Math.random() * 1000)}`,
    balance: 10000,
    roomId: null
  });

  // События комнаты
  socket.on('createRoom', ({ bet, playerName }) => {
    const player = players.get(socket.id);
    if (!player) return;

    if (player.balance < bet) {
      socket.emit('error', { message: 'Недостаточно средств' });
      return;
    }

    const roomId = generateRoomId();
    const newRoom = {
      id: roomId,
      bet,
      players: [{
        id: player.id,
        socketId: socket.id,
        name: playerName || player.name,
        side: Math.random() < 0.5 ? 'heads' : 'tails'
      }],
      status: 'waiting',
      createdAt: new Date()
    };

    rooms.set(roomId, newRoom);
    player.roomId = roomId;
    player.balance -= bet;

    socket.join(roomId);
    socket.emit('roomCreated', newRoom);
    io.emit('roomsUpdated', Array.from(rooms.values()));
  });

  socket.on('joinRoom', ({ roomId, playerName }) => {
    const player = players.get(socket.id);
    const room = rooms.get(roomId);

    if (!room || room.players.length >= 2 || room.status !== 'waiting') {
      socket.emit('error', { message: 'Невозможно присоединиться к комнате' });
      return;
    }

    if (player.balance < room.bet) {
      socket.emit('error', { message: 'Недостаточно средств' });
      return;
    }

    // Добавляем второго игрока
    const secondPlayer = {
      id: player.id,
      socketId: socket.id,
      name: playerName || player.name,
      side: room.players[0].side === 'heads' ? 'tails' : 'heads'
    };

    room.players.push(secondPlayer);
    room.status = 'starting';
    player.roomId = roomId;
    player.balance -= room.bet;

    socket.join(roomId);
    io.to(roomId).emit('roomUpdated', room);
    io.emit('roomsUpdated', Array.from(rooms.values()));

    // Начинаем игру через 5 секунд
    setTimeout(() => {
      if (rooms.has(roomId)) {
        startCoinGame(roomId);
      }
    }, 5000);
  });

  socket.on('swapSides', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.status !== 'starting') return;

    // Меняем стороны местами
    room.players.forEach(player => {
      player.side = player.side === 'heads' ? 'tails' : 'heads';
    });

    io.to(roomId).emit('roomUpdated', room);
  });

  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (!player) return;

    // Обработка выхода из комнаты
    if (player.roomId) {
      const room = rooms.get(player.roomId);
      if (room) {
        // Возвращаем ставку если игрок вышел до начала игры
        if (room.status === 'waiting') {
          player.balance += room.bet;
          rooms.delete(player.roomId);
        } else {
          // Помечаем игрока как отключившегося
          const playerInRoom = room.players.find(p => p.id === player.id);
          if (playerInRoom) playerInRoom.disconnected = true;
        }

        io.to(player.roomId).emit('playerDisconnected', { playerId: player.id });
        io.emit('roomsUpdated', Array.from(rooms.values()));
      }
    }

    players.delete(socket.id);
  });
});

// Логика игры в монетку
function startCoinGame(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  room.status = 'in_progress';
  io.to(roomId).emit('gameStarted', room);

  // Отсчет перед броском
  let countdown = 5;
  const countdownInterval = setInterval(() => {
    io.to(roomId).emit('countdown', { countdown });
    countdown--;

    if (countdown < 0) {
      clearInterval(countdownInterval);
      flipCoin(roomId);
    }
  }, 1000);
}

function flipCoin(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  // Анимация броска (3 секунды)
  io.to(roomId).emit('coinFlipping');

  setTimeout(() => {
    // Определяем результат
    const result = Math.random() < 0.5 ? 'heads' : 'tails';
    const winner = room.players.find(player => player.side === result);
    const loser = room.players.find(player => player.side !== result);

    // Вычисляем выигрыш (с комиссией 3%)
    const winAmount = Math.floor(room.bet * 2 * 0.97);

    // Обновляем балансы
    if (winner && players.has(winner.socketId)) {
      const winnerPlayer = players.get(winner.socketId);
      winnerPlayer.balance += winAmount;
      winnerPlayer.roomId = null;
    }

    if (loser && players.has(loser.socketId)) {
      const loserPlayer = players.get(loser.socketId);
      loserPlayer.roomId = null;
    }

    // Отправляем результат
    io.to(roomId).emit('gameResult', {
      result,
      winner: winner ? winner.id : null,
      winAmount
    });

    // Удаляем комнату
    rooms.delete(roomId);
    io.emit('roomsUpdated', Array.from(rooms.values()));
  }, 3000);
}

// HTTP роуты
app.get('/api/rooms', (req, res) => {
  res.json({
    rooms: Array.from(rooms.values()).filter(room => room.status === 'waiting')
  });
});

app.get('/api/players/:id', (req, res) => {
  const player = players.get(req.params.id);
  res.json(player || { error: 'Player not found' });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});

// Периодическая очистка неактивных комнат
setInterval(() => {
  const now = new Date();
  Array.from(rooms.entries()).forEach(([roomId, room]) => {
    if (room.status === 'waiting' && (now - new Date(room.createdAt)) > 600000) {
      // Возвращаем ставку создателю
      const creator = Array.from(players.values()).find(p => p.id === room.players[0].id);
      if (creator) {
        creator.balance += room.bet;
        creator.roomId = null;
      }
      rooms.delete(roomId);
    }
    // В конце server.js
module.exports = server; // или app, если используете только Express
  });

  io.emit('roomsUpdated', Array.from(rooms.values()));
}, 300000); // Каждые 5 минут
