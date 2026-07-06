import express from "express";
import Quiz from "../models/Quiz.js";
import Question from "../models/Question.js";
import Result from "../models/Result.js";
import Subject from "../models/Subject.js";
import Enrollment from "../models/Enrollment.js";
import { protect } from "../middleware/authMiddleware.js";
import { shuffleArray, getNextDifficulty, pickQuestionByDifficulty } from "../utils/adaptiveDifficulty.js";

const router = express.Router();

const PASS_THRESHOLD = 0.75; // 75% correct required to count as "completed/passed"

// All routes require a logged-in user (student or admin)
router.use(protect);

// ---------------------------------------------
// GET /api/quiz/:quizId/start - fetch shuffled questions to attempt a quiz
// Query param: mode=practice|exam (default exam)
// Query param: adaptive=true|false (default false)
// ---------------------------------------------
router.get("/:quizId/start", async (req, res) => {
  try {
    const { quizId } = req.params;
    const { adaptive } = req.query;

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    const allQuestions = await Question.find({ quizId, isPublished: true });

    if (allQuestions.length === 0) {
      return res.status(400).json({ message: "This quiz has no published questions yet" });
    }

    let selectedQuestions = [];

    if (adaptive === "true") {
      // Adaptive mode: start at medium difficulty, pick one question at a time
      let currentDifficulty = "medium";
      const usedIds = [];

      for (let i = 0; i < allQuestions.length; i++) {
        const nextQ = pickQuestionByDifficulty(allQuestions, currentDifficulty, usedIds);
        if (!nextQ) break;
        usedIds.push(nextQ._id.toString());
        selectedQuestions.push(nextQ);
        // Assume correct for pre-fetch ordering; actual adaptation happens as answers come in (frontend can re-call per question if fully adaptive)
        currentDifficulty = getNextDifficulty(currentDifficulty, true);
      }
    } else {
      // Standard mode: shuffle all questions
      selectedQuestions = shuffleArray(allQuestions);
    }

    // Shuffle options within each question, never send correctAnswer to client
    const sanitizedQuestions = selectedQuestions.map((q) => ({
      _id: q._id,
      questionText: q.questionText,
      options: shuffleArray(q.options),
      difficulty: q.difficulty,
    }));

    res.status(200).json({
      quiz: {
        _id: quiz._id,
        title: quiz.title,
        duration: quiz.duration,
        negativeMarking: quiz.negativeMarking,
        totalQuestions: sanitizedQuestions.length,
      },
      questions: sanitizedQuestions,
    });
  } catch (error) {
    res.status(500).json({ message: "Error starting quiz attempt", error: error.message });
  }
});

// ---------------------------------------------
// POST /api/quiz/:quizId/submit - submit answers, calculate score server-side
// Body: { answers: [{ questionId, selectedAnswer }], mode, courseId }
// Any published question in the quiz NOT present in `answers` is treated as skipped.
// ---------------------------------------------
router.post("/:quizId/submit", async (req, res) => {
  try {
    const { quizId } = req.params;
    const { answers, mode } = req.body;

    if (!Array.isArray(answers)) {
      return res.status(400).json({ message: "Answers array is required" });
    }

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    // Derive the course this quiz belongs to server-side (never trust client for this)
    const subject = await Subject.findById(quiz.subjectId);
    const courseId = subject ? subject.courseId : null;

    // Fetch ALL published questions for this quiz - source of truth for totalQuestions
    const allQuizQuestions = await Question.find({ quizId, isPublished: true });

    if (allQuizQuestions.length === 0) {
      return res.status(400).json({ message: "This quiz has no published questions" });
    }

    const submittedMap = {};
    answers.forEach((a) => {
      submittedMap[a.questionId] = a.selectedAnswer || null;
    });

    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;

    const gradedAnswers = allQuizQuestions.map((question) => {
      const qId = question._id.toString();
      const selected = qId in submittedMap ? submittedMap[qId] : null;

      if (selected === null) {
        skippedCount++;
      } else if (selected === question.correctAnswer) {
        correctCount++;
      } else {
        wrongCount++;
      }

      return {
        questionId: question._id,
        selectedAnswer: selected,
        correctAnswer: question.correctAnswer,
        isCorrect: selected === question.correctAnswer,
      };
    });

    let score = correctCount;
    if (quiz.negativeMarking) {
      score = correctCount - wrongCount * 0.25;
      score = Math.max(score, 0);
    }

    const scorePercent = correctCount / allQuizQuestions.length;
    const passed = scorePercent >= PASS_THRESHOLD;

    // Check if this is the user's FIRST completed attempt at this quiz.
    // Only the first attempt earns XP - retakes are for practice, not farming.
    const previousAttempts = await Result.countDocuments({
      userId: req.user._id,
      quizId,
      status: "completed",
    });
    const isFirstAttempt = previousAttempts === 0;

    const result = await Result.create({
      userId: req.user._id,
      quizId,
      courseId,
      score,
      totalQuestions: allQuizQuestions.length,
      correctCount,
      wrongCount,
      skippedCount,
      passed,
      mode: mode === "practice" ? "practice" : "exam",
      answers: gradedAnswers,
      status: "completed",
      completedAt: new Date(),
    });

    // XP: only awarded on first attempt AND only if passed (>=75%). Prevents farming
    // by retaking, and prevents earning XP for a failing attempt.
    const xpEarned = isFirstAttempt && passed ? correctCount * 10 : 0;
    if (xpEarned > 0) {
      req.user.xp += xpEarned;
      await req.user.save();
    }

    // Update course progress: % of quizzes in the course the user has PASSED (>=75%) at least once
    if (courseId) {
      const subjectsInCourse = await Subject.find({ courseId });
      const subjectIds = subjectsInCourse.map((s) => s._id);
      const quizzesInCourse = await Quiz.find({ subjectId: { $in: subjectIds } });
      const totalQuizzesInCourse = quizzesInCourse.length;

      if (totalQuizzesInCourse > 0) {
        const passedQuizIds = await Result.distinct("quizId", {
          userId: req.user._id,
          courseId,
          status: "completed",
          passed: true,
        });

        const progressPercent = Math.min(
          Math.round((passedQuizIds.length / totalQuizzesInCourse) * 100),
          100
        );

        await Enrollment.findOneAndUpdate(
          { userId: req.user._id, courseId },
          { progressPercent },
          { new: true }
        );
      }
    }

    res.status(201).json({
      message: !passed
        ? `You scored ${Math.round(scorePercent * 100)}%. You need at least 75% to mark this quiz as completed. Try again!`
        : isFirstAttempt
        ? "Quiz completed successfully"
        : "Retake submitted. No additional XP awarded for retakes.",
      result,
      xpEarned,
      isFirstAttempt,
      passed,
    });
  } catch (error) {
    res.status(500).json({ message: "Error submitting quiz", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/quiz/results/my - get logged-in user's result history
// ---------------------------------------------
router.get("/results/my", async (req, res) => {
  try {
    const results = await Result.find({ userId: req.user._id })
      .populate("quizId", "title difficulty")
      .sort({ completedAt: -1 });

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ message: "Error fetching results", error: error.message });
  }
});

export default router;
