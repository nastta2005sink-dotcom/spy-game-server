const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map();

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function generatePlayerId() {
  return 'p_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
}

const MOVIES = [
  { movie: "Harry Potter", actor: "Daniel Radcliffe", emoji: "⚡" },
  { movie: "Notting Hill", actor: "Hugh Grant", emoji: "📖" },
  { movie: "James Bond", actor: "Sean Connery", emoji: "🔫" },
  { movie: "Sherlock Holmes", actor: "Benedict Cumberbatch", emoji: "🔍" },
  { movie: "Mean Girls", actor: "Lindsay Lohan", emoji: "💅" },
  { movie: "Forrest Gump", actor: "Tom Hanks", emoji: "🍫" },
  { movie: "The Dark Knight", actor: "Christian Bale", emoji: "🦇" },
  { movie: "Pulp Fiction", actor: "John Travolta", emoji: "🍔" }
];

const SPIES = [
  { movie: "Paddington", actor: "Meryl Streep", emoji: "🎭" },
  { movie: "Spider-Man", actor: "Tom Holland", emoji: "🕷️" },
  { movie: "House M.D.", actor: "Hugh Laurie", emoji: "🩺" }
];

const QUESTIONS = [
  "Describe the main character of your movie in 2-3 sentences.",
  "What is the most famous scene from your movie?",
  "What would be a good sequel or prequel idea for your movie?",
  "If your actor could be recast, who should it be and why?",
  "Explain why someone should watch your movie in one sentence."
];

function assignRoles(players) {
  const spyIndex = Math.floor(Math.random() * players.length);
  const shuffledMovies = [...MOVIES];
  for (let i = shuffledMovies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledMovies[i], shuffledMovies[j]] = [shuffledMovies[j], shuffledMovies[i]];
  }
  let moviePtr = 0;
  return players.map((player, idx) => {
    const isSpy = (idx === spyIndex);
    if (!isSpy) {
      const movie = shuffledMovies[moviePtr % shuffledMovies.length];
      moviePtr++;
      return { ...player, isSpy: false, movie: movie.movie, actor: movie.actor, emoji: movie.emoji };
    } else {
      const spy = SPIES[Math.floor(Math.random() * SPIES.length)];
      return { ...player, isSpy: true, movie: spy.movie, actor: spy.actor, emoji: spy.emoji };
    }
  });
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('createRoom', (data, callback) => {
    const { playerName } = data;
    const roomCode = generateRoomCode();
    const playerId = generatePlayerId();
    const player = { id: playerId, name: playerName, socketId: socket.id };
    
    rooms.set(roomCode, {
      code: roomCode,
      players: [player],
      playersData: null,
      gameStarted: false,
      currentRound: 0,
      phase: 'waiting',
      votes: {},
      eliminated: [],
      answers: {}
    });
    
    socket.join(roomCode);
    callback({ success: true, roomCode, playerId });
    io.to(roomCode).emit('roomUpdate', {
      players: rooms.get(roomCode).players.map(p => ({ id: p.id, name: p.name })),
      playerCount: rooms.get(roomCode).players.length
    });
  });

  socket.on('joinRoom', (data, callback) => {
    const { roomCode, playerName } = data;
    const room = rooms.get(roomCode.toUpperCase());
    
    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }
    if (room.gameStarted) {
      callback({ success: false, error: 'Game already in progress' });
      return;
    }
    if (room.players.length >= 5) {
      callback({ success: false, error: 'Room is full' });
      return;
    }
    
    const playerId = generatePlayerId();
    const player = { id: playerId, name: playerName, socketId: socket.id };
    room.players.push(player);
    socket.join(roomCode);
    
    callback({ success: true, roomCode, playerId });
    io.to(roomCode).emit('roomUpdate', {
      players: room.players.map(p => ({ id: p.id, name: p.name })),
      playerCount: room.players.length
    });
  });

  socket.on('startGame', (data, callback) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    
    if (!room) {
      callback({ success: false, error: 'Room not found' });
      return;
    }
    if (room.gameStarted) {
      callback({ success: false, error: 'Game already started' });
      return;
    }
    if (room.players.length < 1) {
      callback({ success: false, error: 'Need at least 1 player' });
      return;
    }
    
    room.playersData = assignRoles(room.players);
    room.gameStarted = true;
    room.currentRound = 0;
    room.phase = 'answer';
    room.votes = {};
    room.eliminated = [];
    room.answers = {};
    
    callback({ success: true });
    
    io.to(roomCode).emit('gameStarted', { playersData: room.playersData });
    
    // Отправляем первый вопрос
    io.to(roomCode).emit('roundStart', {
      round: 1,
      totalRounds: 5,
      question: QUESTIONS[0],
      phase: 'answer'
    });
    
    // Таймаут 60 секунд
    room.roundTimeout = setTimeout(() => {
      const currentRoom = rooms.get(roomCode);
      if (currentRoom && currentRoom.phase === 'answer') {
        startVotingPhase(roomCode);
      }
    }, 60000);
  });

  socket.on('answerQuestion', (data, callback) => {
    const { roomCode, answer } = data;
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'answer') {
      if (callback) callback({ success: false });
      return;
    }
    
    room.answers[socket.id] = answer;
    if (callback) callback({ success: true });
    
    const activePlayerIds = room.players.map(p => p.socketId);
    const answeredCount = Object.keys(room.answers).length;
    
    io.to(roomCode).emit('answersCount', { answered: answeredCount, total: activePlayerIds.length });
    
    if (answeredCount >= activePlayerIds.length) {
      clearTimeout(room.roundTimeout);
      startVotingPhase(roomCode);
    }
  });

  function startVotingPhase(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'answer') return;
    
    room.phase = 'vote';
    room.votes = {};
    
    const activePlayers = room.players.filter(p => !room.eliminated.includes(p.id));
    
    io.to(roomCode).emit('votingStart', {
      phase: 'vote',
      players: activePlayers.map(p => ({ id: p.id, name: p.name }))
    });
    
    room.voteTimeout = setTimeout(() => {
      resolveVotes(roomCode);
    }, 45000);
  }

  function resolveVotes(roomCode) {
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'vote') return;
    
    clearTimeout(room.voteTimeout);
    
    const voteCount = {};
    for (const targetId of Object.values(room.votes)) {
      voteCount[targetId] = (voteCount[targetId] || 0) + 1;
    }
    
    let maxVotes = 0;
    let eliminatedId = null;
    for (const [id, count] of Object.entries(voteCount)) {
      if (count > maxVotes) {
        maxVotes = count;
        eliminatedId = id;
      }
    }
    
    if (eliminatedId) {
      const eliminated = room.players.find(p => p.id === eliminatedId);
      const eliminatedData = room.playersData?.find(p => p.playerId === eliminatedId);
      const isSpy = eliminatedData?.isSpy || false;
      
      if (isSpy) {
        io.to(roomCode).emit('gameEnd', { message: `🕵️‍♂️ ${eliminated.name} was the SPY! Civilians win! 🎉` });
        rooms.delete(roomCode);
        return;
      } else {
        room.eliminated.push(eliminatedId);
        io.to(roomCode).emit('voteResult', {
          eliminated: eliminated.name,
          isSpy: false,
          message: `❌ ${eliminated.name} was innocent... The spy remains!`
        });
        room.currentRound++;
        room.phase = 'answer';
        room.answers = {};
        
        if (room.currentRound >= 5) {
          io.to(roomCode).emit('gameEnd', { message: "🎬 Game Over! The spy survived all rounds!" });
          rooms.delete(roomCode);
          return;
        }
        
        io.to(roomCode).emit('roundStart', {
          round: room.currentRound + 1,
          totalRounds: 5,
          question: QUESTIONS[room.currentRound],
          phase: 'answer'
        });
        
        room.roundTimeout = setTimeout(() => {
          const currentRoom = rooms.get(roomCode);
          if (currentRoom && currentRoom.phase === 'answer') {
            startVotingPhase(roomCode);
          }
        }, 60000);
      }
    }
  }

  socket.on('vote', (data, callback) => {
    const { roomCode, targetPlayerId } = data;
    const room = rooms.get(roomCode);
    if (!room || room.phase !== 'vote') {
      callback({ success: false, error: 'Not in voting phase' });
      return;
    }
    if (room.votes[socket.id]) {
      callback({ success: false, error: 'Already voted' });
      return;
    }
    
    room.votes[socket.id] = targetPlayerId;
    callback({ success: true });
    
    const activePlayerIds = room.players.map(p => p.socketId);
    const votedCount = Object.keys(room.votes).length;
    
    if (votedCount >= activePlayerIds.length) {
      resolveVotes(roomCode);
    }
  });

  socket.on('leaveRoom', (data) => {
    const { roomCode } = data;
    const room = rooms.get(roomCode);
    if (room) {
      room.players = room.players.filter(p => p.socketId !== socket.id);
      if (room.players.length === 0) {
        rooms.delete(roomCode);
      } else {
        io.to(roomCode).emit('roomUpdate', {
          players: room.players.map(p => ({ id: p.id, name: p.name })),
          playerCount: room.players.length
        });
      }
    }
    socket.leave(roomCode);
  });

  socket.on('disconnect', () => {
    for (const [roomCode, room] of rooms.entries()) {
      const playerExists = room.players.some(p => p.socketId === socket.id);
      if (playerExists) {
        room.players = room.players.filter(p => p.socketId !== socket.id);
        if (room.players.length === 0) {
          rooms.delete(roomCode);
        } else {
          io.to(roomCode).emit('roomUpdate', {
            players: room.players.map(p => ({ id: p.id, name: p.name })),
            playerCount: room.players.length
          });
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
