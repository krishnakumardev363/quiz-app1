import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";
import authRoutes from "./routes/authRoutes.js";
import adminCourseRoutes from "./routes/adminCourseRoutes.js";
import adminSubjectRoutes from "./routes/adminSubjectRoutes.js";
import adminQuizRoutes from "./routes/adminQuizRoutes.js";
import adminQuestionRoutes from "./routes/adminQuestionRoutes.js";
import quizAttemptRoutes from "./routes/quizAttemptRoutes.js";
import aiQuestionRoutes from "./routes/aiQuestionRoutes.js";
import courseRoutes from "./routes/courseRoutes.js";
import leaderboardRoutes from "./routes/leaderboardRoutes.js";
import certificateRoutes from "./routes/certificateRoutes.js";
import adminLessonRoutes from "./routes/adminLessonRoutes.js";
import xpStoreRoutes from "./routes/xpStoreRoutes.js";
import adminUserRoutes from "./routes/adminUserRoutes.js";
import registerSocketHandlers from "./socketHandlers.js";

dotenv.config();

const app = express();

// Trim any accidental whitespace/trailing slash from the env var - a common
// source of CORS mismatches that are hard to spot visually.
const allowedOrigin = (process.env.CLIENT_URL || "http://localhost:5173").trim().replace(/\/$/, "");


// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: allowedOrigin,
    credentials: true,
  })
);

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/admin/courses", adminCourseRoutes);
app.use("/api/admin/subjects", adminSubjectRoutes);
app.use("/api/admin/quizzes", adminQuizRoutes);
app.use("/api/admin/questions", adminQuestionRoutes);
app.use("/api/quiz", quizAttemptRoutes);
app.use("/api/admin/ai-questions", aiQuestionRoutes);
app.use("/api/courses", courseRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/certificate", certificateRoutes);
app.use("/api/admin/lessons", adminLessonRoutes);
app.use("/api/xp-store", xpStoreRoutes);
app.use("/api/admin/users", adminUserRoutes);

// Health check
app.get("/", (req, res) => {
  res.send("Quiz App API is running...");
});

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000;

const httpServer = createServer(app);

// Trim any accidental whitespace/trailing slash from the env var - a common
// source of CORS mismatches that are hard to spot visually.
// const allowedOrigin = (process.env.CLIENT_URL || "http://localhost:5173").trim().replace(/\/$/, "");


const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigin,
    credentials: true,
  },
  transports: ["polling", "websocket"],
  pingTimeout: 30000,
  pingInterval: 25000,
});
registerSocketHandlers(io);

// Logs the EXACT reason Socket.io rejected a connection attempt - check
// your Render server logs for this after reproducing the issue.
io.engine.on("connection_error", (err) => {
  console.log("Socket.io connection error:");
  console.log("  code:", err.code);
  console.log("  message:", err.message);
  console.log("  context:", err.context);
  console.log("  allowed origin was:", allowedOrigin);
});

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected successfully");
    httpServer.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  });
