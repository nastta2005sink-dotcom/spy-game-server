const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map();

// ФИЛЬМЫ И АКТЁРЫ (один фильм, много актёров)
const MOVIES_DB = [
    {
        movie: "The Dark Knight",
        actors: ["Christian Bale", "Heath Ledger", "Michael Caine", "Gary Oldman", "Morgan Freeman"],
        emoji: "🦇",
        description: "Gotham's dark hero fights chaos"
    },
    {
        movie: "Harry Potter and the Sorcerer's Stone",
        actors: ["Daniel Radcliffe", "Emma Watson", "Rupert Grint", "Richard Harris", "Alan Rickman"],
        emoji: "⚡",
        description: "Young wizard discovers magic school"
    },
    {
        movie: "Pulp Fiction",
        actors: ["John Travolta", "Uma Thurman", "Samuel L. Jackson", "Bruce Willis", "Harvey Keitel"],
        emoji: "🍔",
        description: "Interconnected crime stories"
    },
    {
        movie: "Forrest Gump",
        actors: ["Tom Hanks", "Robin Wright", "Gary Sinise", "Mykelti Williamson", "Sally Field"],
        emoji: "🍫",
        description: "Simple man witnesses history"
    },
    {
        movie: "Titanic",
        actors: ["Leonardo DiCaprio", "Kate Winslet", "Billy Zane", "Kathy Bates", "Gloria Stuart"],
        emoji: "🚢",
        description: "Love story on a sinking ship"
    },
    {
        movie: "The Matrix",
        actors: ["Keanu Reeves", "Laurence Fishburne", "Carrie-Anne Moss", "Hugo Weaving", "Joe Pantoliano"],
        emoji: "💊",
        description: "Reality is a simulation"
    }
];

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', (name) => {
        const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        const player = { id: socket.id, name: name, isHost: true };
        
        // Выбираем случайный фильм для комнаты
        const selectedMovie = MOVIES_DB[Math.floor(Math.random() * MOVIES_DB.length)];
        
        rooms.set(roomCode, { 
            players: [player], 
            gameStarted: false,
            selectedMovie: selectedMovie,
            spyId: null,
            votes: {}
        });
        socket.join(roomCode);
        socket.emit('roomCreated', { roomCode, player });
        io.to(roomCode).emit('updatePlayers', rooms.get(roomCode).players);
    });

    socket.on('joinRoom', ({ code, name }) => {
        const room = rooms.get(code.toUpperCase());
        if (room && !room.gameStarted) {
            const player = { id: socket.id, name: name, isHost: false };
            room.players.push(player);
            socket.join(code.toUpperCase());
            io.to(code.toUpperCase()).emit('updatePlayers', room.players);
            socket.emit('joinedRoom', { roomCode: code.toUpperCase(), player });
        } else {
            socket.emit('error', 'Room not found or game already started');
        }
    });

    socket.on('startGame', (roomCode) => {
        const room = rooms.get(roomCode);
        if (room && !room.gameStarted && room.players.length >= 1) {
            room.gameStarted = true;
            
            // Выбираем шпиона
            const spyIndex = Math.floor(Math.random() * room.players.length);
            room.spyId = room.players[spyIndex].id;
            
            // Отправляем каждому игроку его данные
            room.players.forEach((player, idx) => {
                const isSpy = (player.id === room.spyId);
                
                let assignedActor = null;
                if (!isSpy) {
                    // Каждому не-шпиону даём РАЗНОГО актёра из фильма
                    const actorIndex = idx % room.selectedMovie.actors.length;
                    assignedActor = room.selectedMovie.actors[actorIndex];
                }
                
                io.to(player.id).emit('gameStarted', {
                    isSpy: isSpy,
                    movie: isSpy ? null : room.selectedMovie.movie,
                    actor: assignedActor,
                    emoji: isSpy ? "🕵️" : room.selectedMovie.emoji,
                    description: isSpy ? null : room.selectedMovie.description,
                    players: room.players.map(p => ({ id: p.id, name: p.name }))
                });
            });
        }
    });

    socket.on('submitVote', ({ roomCode, targetId }) => {
        const room = rooms.get(roomCode);
        if (room) {
            room.votes[socket.id] = targetId;
            
            const allPlayers = room.players;
            const allVoted = allPlayers.every(p => room.votes[p.id]);
            
            io.to(roomCode).emit('voteCast', { 
                total: Object.keys(room.votes).length, 
                needed: allPlayers.length 
            });
            
            if (allVoted) {
                const voteCount = {};
                for (const target of Object.values(room.votes)) {
                    voteCount[target] = (voteCount[target] || 0) + 1;
                }
                let maxVotes = 0;
                let eliminatedId = null;
                for (const [id, count] of Object.entries(voteCount)) {
                    if (count > maxVotes) {
                        maxVotes = count;
                        eliminatedId = id;
                    }
                }
                
                const isSpy = (eliminatedId === room.spyId);
                const eliminatedPlayer = room.players.find(p => p.id === eliminatedId);
                
                io.to(roomCode).emit('voteResult', {
                    isSpy,
                    eliminatedName: eliminatedPlayer?.name
                });
                
                if (isSpy) {
                    io.to(roomCode).emit('gameEnd', { message: `🕵️‍♂️ ${eliminatedPlayer.name} was the SPY! Civilians win! 🎉` });
                } else {
                    io.to(roomCode).emit('gameEnd', { message: `❌ ${eliminatedPlayer.name} was innocent... The spy wins!` });
                }
            }
        }
    });

    socket.on('disconnect', () => {
        for (const [roomCode, room] of rooms.entries()) {
            const playerExists = room.players.some(p => p.id === socket.id);
            if (playerExists) {
                room.players = room.players.filter(p => p.id !== socket.id);
                if (room.players.length === 0) {
                    rooms.delete(roomCode);
                } else {
                    io.to(roomCode).emit('updatePlayers', room.players);
                }
                break;
            }
        }
        console.log('User disconnected:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
