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

const MOVIES = [
    { movie: "Inception", actor: "Leonardo DiCaprio", emoji: "🌀" },
    { movie: "The Dark Knight", actor: "Christian Bale", emoji: "🦇" },
    { movie: "Skyfall", actor: "Daniel Craig", emoji: "🍸" },
    { movie: "Mission Impossible", actor: "Tom Cruise", emoji: "🏃" },
    { movie: "The Matrix", actor: "Keanu Reeves", emoji: "💊" },
    { movie: "Harry Potter", actor: "Daniel Radcliffe", emoji: "⚡" },
    { movie: "Forrest Gump", actor: "Tom Hanks", emoji: "🍫" },
    { movie: "Pulp Fiction", actor: "John Travolta", emoji: "🍔" }
];

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    socket.on('createRoom', (name) => {
        const roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
        const player = { id: socket.id, name: name, isHost: true };
        rooms.set(roomCode, { 
            players: [player], 
            gameStarted: false, 
            movie: null, 
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
            const movieData = MOVIES[Math.floor(Math.random() * MOVIES.length)];
            room.movie = movieData;
            room.spyId = room.players[Math.floor(Math.random() * room.players.length)].id;
            
            io.to(roomCode).emit('gameStarted', {
                movie: room.movie,
                spyId: room.spyId,
                players: room.players
            });
        }
    });

    socket.on('submitVote', ({ roomCode, targetId }) => {
        const room = rooms.get(roomCode);
        if (room) {
            room.votes[socket.id] = targetId;
            
            const allPlayers = room.players.filter(p => !room.eliminated?.includes(p.id));
            const allVoted = allPlayers.every(p => room.votes[p.id]);
            
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
                io.to(roomCode).emit('voteResult', {
                    eliminatedId,
                    isSpy,
                    eliminatedName: room.players.find(p => p.id === eliminatedId)?.name
                });
                
                if (isSpy) {
                    io.to(roomCode).emit('gameEnd', { message: 'Spy was caught! Civilians win!' });
                } else {
                    io.to(roomCode).emit('gameEnd', { message: 'Innocent was voted out! Spy wins!' });
                }
            } else {
                io.to(roomCode).emit('voteCast', { voter: socket.id, target: targetId, total: Object.keys(room.votes).length, needed: allPlayers.length });
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
