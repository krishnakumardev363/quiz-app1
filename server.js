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
import registerSocketHandlers from "./socketHandlers.js";

dotenv.config();

const app = express();

// Middleware
app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
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

// Health check
app.get("/", (req, res) => {
  res.send("Quiz App API is running...");
});

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000;

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  },
});
registerSocketHandlers(io);

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
