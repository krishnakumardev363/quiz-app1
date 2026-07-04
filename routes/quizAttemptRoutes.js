import express from "express";
import Quiz from "../models/Quiz.js";
import Question from "../models/Question.js";
import Result from "../models/Result.js";
import { protect } from "../middleware/authMiddleware.js";
import { shuffleArray, getNextDifficulty, pickQuestionByDifficulty } from "../utils/adaptiveDifficulty.js";

const router = express.Router();

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
    const { answers, mode, courseId } = req.body;

    if (!Array.isArray(answers)) {
      return res.status(400).json({ message: "Answers array is required" });
    }

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    // Fetch ALL published questions for this quiz - this is the source of truth
    // for totalQuestions, not just the ones the client happened to submit.
    const allQuizQuestions = await Question.find({ quizId, isPublished: true });

    if (allQuizQuestions.length === 0) {
      return res.status(400).json({ message: "This quiz has no published questions" });
    }

    // Map submitted answers by questionId for quick lookup
    const submittedMap = {};
    answers.forEach((a) => {
      submittedMap[a.questionId] = a.selectedAnswer || null;
    });

    let correctCount = 0;
    let wrongCount = 0;
    let skippedCount = 0;

    // Loop over EVERY question in the quiz, not just submitted ones
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

    // Scoring: +1 per correct. If negative marking enabled, -0.25 per wrong (never below 0)
    let score = correctCount;
    if (quiz.negativeMarking) {
      score = correctCount - wrongCount * 0.25;
      score = Math.max(score, 0);
    }

    const result = await Result.create({
      userId: req.user._id,
      quizId,
      courseId: courseId || null,
      score,
      totalQuestions: allQuizQuestions.length,
      correctCount,
      wrongCount,
      skippedCount,
      mode: mode === "practice" ? "practice" : "exam",
      answers: gradedAnswers,
      status: "completed",
      completedAt: new Date(),
    });

    // Award XP: +10 per correct answer (simple gamification hook)
    const xpEarned = correctCount * 10;
    req.user.xp += xpEarned;
    await req.user.save();

    res.status(201).json({
      message: "Quiz submitted successfully",
      result,
      xpEarned,
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