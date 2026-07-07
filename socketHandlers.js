import jwt from "jsonwebtoken";
import User from "./models/User.js";
import Question from "./models/Question.js";
import Quiz from "./models/Quiz.js";
import Subject from "./models/Subject.js";
import Result from "./models/Result.js";

// In-memory room store. Fine for a college project / single-server setup.
// Shape: { [roomCode]: { hostSocketId, quizId, courseId, quizTitle, players: [{socketId, userId, name, score, correctCount, wrongCount, skippedCount, hasAnsweredCurrent}], status, questions, currentIndex, questionStartTime } }
const rooms = {};

const QUESTION_TIME_LIMIT_SECONDS = 20;

const generateRoomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars like 0/O, 1/I
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const getLeaderboard = (room) =>
  [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p, idx) => ({
      rank: idx + 1,
      name: p.name,
      score: p.score,
      userId: p.userId,
      hasAnsweredCurrent: p.hasAnsweredCurrent,
    }));

// Extracts and verifies the JWT from the socket's handshake cookies.
// Returns the User document if valid, otherwise null. Used so we never
// trust a client-supplied name/userId for scoring or identity.
const getUserFromSocket = async (socket) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie || "";
    const match = cookieHeader.match(/token=([^;]+)/);
    if (!match) return null;

    const decoded = jwt.verify(match[1], process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    return user;
  } catch (error) {
    return null;
  }
};

export default function registerSocketHandlers(io) {
  io.on("connection", (socket) => {
    // ---------------------------------------------
    // HOST: create a room for a given quiz (admin only, host does NOT play)
    // ---------------------------------------------
    socket.on("create-room", async ({ quizId }) => {
      try {
        const user = await getUserFromSocket(socket);
        if (!user || user.role !== "admin") {
          socket.emit("room-error", {
            message: "Only admins/instructors can host a live quiz room.",
          });
          return;
        }

        const quiz = await Quiz.findById(quizId);
        if (!quiz) {
          socket.emit("room-error", { message: "Quiz not found" });
          return;
        }

        const questions = await Question.find({ quizId, isPublished: true });
        if (questions.length === 0) {
          socket.emit("room-error", { message: "This quiz has no published questions" });
          return;
        }

        const subject = await Subject.findById(quiz.subjectId);
        const courseId = subject ? subject.courseId : null;

        let code = generateRoomCode();
        while (rooms[code]) code = generateRoomCode(); // ensure uniqueness

        rooms[code] = {
          hostSocketId: socket.id,
          quizId,
          courseId,
          quizTitle: quiz.title,
          players: [],
          status: "waiting", // waiting | in-progress | finished
          questions: shuffle(questions).map((q) => ({
            _id: q._id.toString(),
            questionText: q.questionText,
            options: shuffle(q.options),
            correctAnswer: q.correctAnswer,
          })),
          currentIndex: -1,
          questionStartTime: null,
        };

        socket.join(code);
        socket.emit("room-created", { roomCode: code, quizTitle: quiz.title });
      } catch (error) {
        socket.emit("room-error", { message: "Could not create room" });
      }
    });

    // ---------------------------------------------
    // PLAYER: join an existing room by code - identity always comes from
    // the verified session, never from client input, to prevent spoofing.
    // ---------------------------------------------
    socket.on("join-room", async ({ roomCode }) => {
      const room = rooms[roomCode];
      if (!room) {
        socket.emit("room-error", { message: "Room not found. Check the code and try again." });
        return;
      }
      if (room.status !== "waiting") {
        socket.emit("room-error", { message: "This quiz has already started." });
        return;
      }

      const user = await getUserFromSocket(socket);
      if (!user) {
        socket.emit("room-error", { message: "Please log in again to join." });
        return;
      }

      // Prevent the same user joining twice (e.g. accidental double click)
      const alreadyJoined = room.players.some((p) => p.userId === user._id.toString());
      if (!alreadyJoined) {
        room.players.push({
          socketId: socket.id,
          userId: user._id.toString(),
          name: user.name,
          score: 0,
          correctCount: 0,
          wrongCount: 0,
          skippedCount: 0,
          hasAnsweredCurrent: false,
        });
      }

      socket.join(roomCode);
      socket.emit("joined-room", { quizTitle: room.quizTitle });

      io.to(roomCode).emit("player-list-updated", {
        players: room.players.map((p) => ({ name: p.name, userId: p.userId })),
      });
    });

    // ---------------------------------------------
    // HOST: start the quiz - sends first question to everyone in the room
    // ---------------------------------------------
    socket.on("start-quiz", ({ roomCode }) => {
      const room = rooms[roomCode];
      if (!room || room.hostSocketId !== socket.id) return;

      room.status = "in-progress";
      sendNextQuestion(io, roomCode);
    });

    // ---------------------------------------------
    // PLAYER: submit an answer for the current question
    // ---------------------------------------------
    socket.on("submit-answer", ({ roomCode, questionIndex, selectedAnswer }) => {
      const room = rooms[roomCode];
      if (!room || room.currentIndex !== questionIndex) return;

      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player || player.hasAnsweredCurrent) return;

      const question = room.questions[questionIndex];
      const isCorrect = selectedAnswer === question.correctAnswer;

      if (isCorrect) {
        // Faster correct answers earn slightly more points (rewards speed)
        const elapsedSeconds = (Date.now() - room.questionStartTime) / 1000;
        const speedBonus = Math.max(0, QUESTION_TIME_LIMIT_SECONDS - elapsedSeconds);
        player.score += Math.round(10 + speedBonus);
        player.correctCount += 1;
      } else {
        player.wrongCount += 1;
      }
      player.hasAnsweredCurrent = true;

      io.to(roomCode).emit("leaderboard-update", { leaderboard: getLeaderboard(room) });

      // If everyone has answered, move to the next question early
      if (room.players.every((p) => p.hasAnsweredCurrent)) {
        clearTimeout(room.questionTimer);
        sendNextQuestion(io, roomCode);
      }
    });

    // ---------------------------------------------
    // Handle disconnects - remove player from any room they were in
    // ---------------------------------------------
    socket.on("disconnect", () => {
      Object.entries(rooms).forEach(([code, room]) => {
        room.players = room.players.filter((p) => p.socketId !== socket.id);
        if (room.players.length > 0) {
          io.to(code).emit("player-list-updated", {
            players: room.players.map((p) => ({ name: p.name, userId: p.userId })),
          });
        }
        if (room.hostSocketId === socket.id && room.status !== "finished") {
          io.to(code).emit("room-error", { message: "Host disconnected. Room closed." });
          delete rooms[code];
        }
      });
    });
  });

  function sendNextQuestion(io, roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    // Players who never answered the previous question count as skipped
    if (room.currentIndex >= 0) {
      room.players.forEach((p) => {
        if (!p.hasAnsweredCurrent) p.skippedCount += 1;
      });
    }

    room.currentIndex += 1;
    room.players.forEach((p) => (p.hasAnsweredCurrent = false));

    if (room.currentIndex >= room.questions.length) {
      finishQuiz(io, roomCode);
      return;
    }

    room.questionStartTime = Date.now();
    const q = room.questions[room.currentIndex];

    io.to(roomCode).emit("new-question", {
      index: room.currentIndex,
      total: room.questions.length,
      questionText: q.questionText,
      options: q.options,
      timeLimit: QUESTION_TIME_LIMIT_SECONDS,
    });

    room.questionTimer = setTimeout(() => {
      sendNextQuestion(io, roomCode);
    }, QUESTION_TIME_LIMIT_SECONDS * 1000);
  }

  async function finishQuiz(io, roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    room.status = "finished";
    const leaderboard = getLeaderboard(room);
    io.to(roomCode).emit("quiz-finished", { leaderboard });

    // Persist a Result document per player so it shows up in their history
    try {
      const totalPlayers = room.players.length;
      await Promise.all(
        room.players.map((p) => {
          const rankEntry = leaderboard.find((l) => l.userId === p.userId);
          return Result.create({
            userId: p.userId,
            quizId: room.quizId,
            courseId: room.courseId,
            score: p.score,
            totalQuestions: room.questions.length,
            correctCount: p.correctCount,
            wrongCount: p.wrongCount,
            skippedCount: p.skippedCount,
            mode: "multiplayer",
            answers: [],
            status: "completed",
            completedAt: new Date(),
            rank: rankEntry ? rankEntry.rank : null,
            totalPlayers,
          });
        })
      );
    } catch (error) {
      console.error("Error saving multiplayer results:", error.message);
    }

    // Room stays around briefly in case the host view still needs it, then cleanup
    setTimeout(() => delete rooms[roomCode], 5 * 60 * 1000);
  }
}
