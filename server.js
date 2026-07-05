import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import cors from "cors";
import authRoutes from "./routes/authRoutes.js";
import adminCourseRoutes from "./routes/adminCourseRoutes.js";
import adminSubjectRoutes from "./routes/adminSubjectRoutes.js";
import adminQuizRoutes from "./routes/adminQuizRoutes.js";
import adminQuestionRoutes from "./routes/adminQuestionRoutes.js";
import quizAttemptRoutes from "./routes/quizAttemptRoutes.js";
import aiQuestionRoutes from "./routes/aiQuestionRoutes.js";

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

// Health check
app.get("/", (req, res) => {
  res.send("Quiz App API is running...");
});

// Connect to MongoDB and start server
const PORT = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected successfully");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection failed:", error.message);
    process.exit(1);
  });
