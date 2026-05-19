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

// 20 КУЛЬТОВЫХ ФИЛЬМОВ С АКТЁРАМИ
const MOVIES = [
    { movie: "The Dark Knight", actor: "Christian Bale", emoji: "🦇" },
    { movie: "Inception", actor: "Leonardo DiCaprio", emoji: "🌀" },
    { movie: "Pulp Fiction", actor: "John Travolta", emoji: "🍔" },
    { movie: "Forrest Gump", actor: "Tom Hanks", emoji: "🍫" },
    { movie: "The Matrix", actor: "Keanu Reeves", emoji: "💊" },
    { movie: "Titanic", actor: "Leonardo DiCaprio", emoji: "🚢" },
    { movie: "Harry Potter", actor: "Daniel Radcliffe", emoji: "⚡" },
    { movie: "Star Wars", actor: "Harrison Ford", emoji: "⭐" },
    { movie: "Jurassic Park", actor: "Sam Neill", emoji: "🦖" },
    { movie: "Fight Club", actor: "Brad Pitt", emoji: "🧼" },
    { movie: "The Godfather", actor: "Marlon Brando", emoji: "🍝" },
    { movie: "Gladiator", actor: "Russell Crowe", emoji: "⚔️" },
    { movie: "Avatar", actor: "Sam Worthington", emoji: "🌌" },
    { movie: "The Shawshank Redemption", actor: "Tim Robbins", emoji: "🔨" },
    { movie: "Back to the Future", actor: "Michael J. Fox", emoji: "⏰" },
    { movie: "Jaws", actor: "Roy Scheider", emoji: "🦈" },
    { movie: "Indiana Jones", actor: "Harrison Ford", emoji: "🎩" },
    { movie: "The Lion King", actor: "Matthew Broderick", emoji: "🦁" },
    { movie: "E.T.", actor: "Drew Barrymore", emoji: "👽" },
    { movie: "The Silence of the Lambs", actor: "Anthony Hopkins", emoji: "🔪" }
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
            votes: {},
            playersMovies: new Map()
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
            
            // Перемешиваем фильмы
            const shuffledMovies = [...MOVIES];
            for (let i = shuffledMovies.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffledMovies[i], shuffledMovies[j]] = [shuffledMovies[j], shuffledMovies[i]];
            }
            
            // Выдаём каждому игроку свой фильм (уникальный)
            room.players.forEach((player, index) => {
                const movieData = shuffledMovies[index % shuffledMovies.length];
                room.playersMovies.set(player.id, movieData);
            });
            
            // Выбираем шпиона (один из игроков ничего не знает о фильме)
            const spyIndex = Math.floor(Math.random() * room.players.length);
            room.spyId = room.players[spyIndex].id;
            
            // Отправляем каждому игроку его данные
            room.players.forEach(player => {
                const isSpy = (player.id === room.spyId);
                const movieData = room.playersMovies.get(player.id);
                
                io.to(player.id).emit('gameStarted', {
                    isSpy: isSpy,
                    movie: isSpy ? null : movieData.movie,
                    actor: isSpy ? null : movieData.actor,
                    emoji: isSpy ? "🕵️" : movieData.emoji,
                    players: room.players.map(p => ({ id: p.id, name: p.name }))
                });
            });
        }
    });

    socket.on('submitVote', ({ roomCode, targetId }) => {
        const room = rooms.get(roomCode);
        if (room) {
            room.votes[socket.id] = targetId;
            
            const allPlayers = room.players.filter(p => !room.eliminated?.includes(p.id));
            const allVoted = allPlayers.every(p => room.votes[p.id]);
            
            io.to(roomCode).emit('voteCast', { 
                voter: socket.id, 
                target: targetId, 
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
                    eliminatedId,
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
