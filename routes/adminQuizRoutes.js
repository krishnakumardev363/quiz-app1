import express from "express";
import Quiz from "../models/Quiz.js";
import Question from "../models/Question.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, authorizeRoles("admin"));

// POST /api/admin/quizzes - create quiz
router.post("/", async (req, res) => {
  try {
    const { subjectId, title, difficulty, duration, negativeMarking, order } = req.body;

    if (!subjectId || !title) {
      return res.status(400).json({ message: "subjectId and title are required" });
    }

    const quiz = await Quiz.create({
      subjectId,
      title,
      difficulty,
      duration,
      negativeMarking,
      order,
    });

    res.status(201).json(quiz);
  } catch (error) {
    res.status(500).json({ message: "Error creating quiz", error: error.message });
  }
});

// GET /api/admin/quizzes/subject/:subjectId - list quizzes for a subject
router.get("/subject/:subjectId", async (req, res) => {
  try {
    const quizzes = await Quiz.find({ subjectId: req.params.subjectId }).sort({ order: 1 });
    res.status(200).json(quizzes);
  } catch (error) {
    res.status(500).json({ message: "Error fetching quizzes", error: error.message });
  }
});

// GET /api/admin/quizzes/:id - get single quiz
router.get("/:id", async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }
    res.status(200).json(quiz);
  } catch (error) {
    res.status(500).json({ message: "Error fetching quiz", error: error.message });
  }
});

// PUT /api/admin/quizzes/:id - update quiz
router.put("/:id", async (req, res) => {
  try {
    const quiz = await Quiz.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }
    res.status(200).json(quiz);
  } catch (error) {
    res.status(500).json({ message: "Error updating quiz", error: error.message });
  }
});

// DELETE /api/admin/quizzes/:id - delete quiz (also deletes its questions)
router.delete("/:id", async (req, res) => {
  try {
    const quiz = await Quiz.findByIdAndDelete(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }
    await Question.deleteMany({ quizId: req.params.id });
    res.status(200).json({ message: "Quiz and its questions deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting quiz", error: error.message });
  }
});

// POST /api/admin/quizzes/:id/duplicate - duplicate a quiz with its questions
router.post("/:id/duplicate", async (req, res) => {
  try {
    const quiz = await Quiz.findById(req.params.id);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    const newQuiz = await Quiz.create({
      subjectId: quiz.subjectId,
      title: `${quiz.title} (Copy)`,
      difficulty: quiz.difficulty,
      duration: quiz.duration,
      negativeMarking: quiz.negativeMarking,
      order: quiz.order,
    });

    const questions = await Question.find({ quizId: quiz._id });
    const duplicatedQuestions = questions.map((q) => ({
      quizId: newQuiz._id,
      questionText: q.questionText,
      options: q.options,
      correctAnswer: q.correctAnswer,
      difficulty: q.difficulty,
      source: q.source,
      isPublished: q.isPublished,
    }));

    if (duplicatedQuestions.length > 0) {
      await Question.insertMany(duplicatedQuestions);
    }

    newQuiz.totalQuestions = duplicatedQuestions.length;
    await newQuiz.save();

    res.status(201).json(newQuiz);
  } catch (error) {
    res.status(500).json({ message: "Error duplicating quiz", error: error.message });
  }
});

export default router;
