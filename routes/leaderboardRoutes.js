import express from "express";
import User from "../models/User.js";
import Result from "../models/Result.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

// ---------------------------------------------
// GET /api/leaderboard/global - top users ranked by XP
// ---------------------------------------------
router.get("/global", async (req, res) => {
  try {
    const topUsers = await User.find({ role: "student" })
      .select("name xp streak badges")
      .sort({ xp: -1 })
      .limit(50);

    const leaderboard = topUsers.map((u, index) => ({
      rank: index + 1,
      userId: u._id,
      name: u.name,
      xp: u.xp,
      streak: u.streak,
      badges: u.badges,
    }));

    // Find the logged-in user's own rank (even if outside top 50)
    const allStudents = await User.find({ role: "student" }).select("_id xp").sort({ xp: -1 });
    const myRank = allStudents.findIndex((u) => u._id.toString() === req.user._id.toString()) + 1;

    res.status(200).json({ leaderboard, myRank: myRank || null });
  } catch (error) {
    res.status(500).json({ message: "Error fetching leaderboard", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/leaderboard/course/:courseId - ranking within a specific course
// Ranked by total correct answers across all passed quizzes in that course
// ---------------------------------------------
router.get("/course/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;

    const results = await Result.find({ courseId, status: "completed" }).populate(
      "userId",
      "name"
    );

    // Aggregate total correct answers per user within this course
    const scoreByUser = {};
    results.forEach((r) => {
      if (!r.userId) return;
      const uid = r.userId._id.toString();
      if (!scoreByUser[uid]) {
        scoreByUser[uid] = { name: r.userId.name, totalCorrect: 0, quizzesTaken: 0 };
      }
      scoreByUser[uid].totalCorrect += r.correctCount;
      scoreByUser[uid].quizzesTaken += 1;
    });

    const leaderboard = Object.entries(scoreByUser)
      .map(([userId, data]) => ({ userId, ...data }))
      .sort((a, b) => b.totalCorrect - a.totalCorrect)
      .map((entry, index) => ({ rank: index + 1, ...entry }));

    res.status(200).json(leaderboard);
  } catch (error) {
    res.status(500).json({ message: "Error fetching course leaderboard", error: error.message });
  }
});

export default router;
