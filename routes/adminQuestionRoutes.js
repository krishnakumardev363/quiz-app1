import express from "express";
import Question from "../models/Question.js";
import Quiz from "../models/Quiz.js";
import Result from "../models/Result.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, authorizeRoles("admin"));

// Helper: recalculate totalQuestions count on the quiz
const updateQuizQuestionCount = async (quizId) => {
  const count = await Question.countDocuments({ quizId });
  await Quiz.findByIdAndUpdate(quizId, { totalQuestions: count });
};

// POST /api/admin/questions - create question
router.post("/", async (req, res) => {
  try {
    const { quizId, questionText, options, correctAnswer, difficulty } = req.body;

    if (!quizId || !questionText || !options || !correctAnswer) {
      return res.status(400).json({
        message: "quizId, questionText, options and correctAnswer are required",
      });
    }

    if (!options.includes(correctAnswer)) {
      return res.status(400).json({ message: "correctAnswer must be one of the options" });
    }

    const question = await Question.create({
      quizId,
      questionText,
      options,
      correctAnswer,
      difficulty,
      source: "manual",
    });

    await updateQuizQuestionCount(quizId);

    res.status(201).json(question);
  } catch (error) {
    res.status(500).json({ message: "Error creating question", error: error.message });
  }
});

// GET /api/admin/questions/quiz/:quizId - list questions for a quiz
router.get("/quiz/:quizId", async (req, res) => {
  try {
    const questions = await Question.find({ quizId: req.params.quizId });
    res.status(200).json(questions);
  } catch (error) {
    res.status(500).json({ message: "Error fetching questions", error: error.message });
  }
});

// PUT /api/admin/questions/:id - update question
router.put("/:id", async (req, res) => {
  try {
    const question = await Question.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }
    res.status(200).json(question);
  } catch (error) {
    res.status(500).json({ message: "Error updating question", error: error.message });
  }
});

// DELETE /api/admin/questions/:id - delete question
router.delete("/:id", async (req, res) => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }
    await updateQuizQuestionCount(question.quizId);
    res.status(200).json({ message: "Question deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting question", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/admin/questions/results/all - admin view of ALL quiz results, most recent first
// ---------------------------------------------
router.get("/results/all", async (req, res) => {
  try {
    const results = await Result.find()
      .populate("userId", "name email")
      .populate("quizId", "title")
      .sort({ completedAt: -1 })
      .limit(200);

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ message: "Error fetching results history", error: error.message });
  }
});

// ---------------------------------------------
// DELETE /api/admin/questions/results/:id - delete a specific result entry
// ---------------------------------------------
router.delete("/results/:id", async (req, res) => {
  try {
    const result = await Result.findByIdAndDelete(req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Result not found" });
    }
    res.status(200).json({ message: "Result deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting result", error: error.message });
  }
});

export default router;
