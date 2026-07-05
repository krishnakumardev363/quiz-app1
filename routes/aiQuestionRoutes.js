import express from "express";
import Question from "../models/Question.js";
import Quiz from "../models/Quiz.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Admin only - generating and reviewing AI questions is an admin task
router.use(protect, authorizeRoles("admin"));

// ---------------------------------------------
// POST /api/admin/ai-questions/generate
// Body: { quizId, topic, difficulty, count }
// Calls Anthropic API to generate MCQs, saves them as UNPUBLISHED for admin review.
// ---------------------------------------------
router.post("/generate", async (req, res) => {
  try {
    const { quizId, topic, difficulty, count } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        message:
          "AI question generation is not configured yet. Add GEMINI_API_KEY to your .env file to enable this feature.",
      });
    }

    if (!quizId || !topic || !count) {
      return res.status(400).json({ message: "quizId, topic and count are required" });
    }

    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    const safeDifficulty = ["easy", "medium", "hard"].includes(difficulty) ? difficulty : "medium";
    const safeCount = Math.min(Math.max(parseInt(count) || 5, 1), 20); // clamp between 1-20

    const prompt = `Generate ${safeCount} multiple choice questions about "${topic}" at ${safeDifficulty} difficulty level.

Return ONLY a JSON array, no preamble, no markdown code fences, no explanation. Each item must have this exact shape:
{
  "questionText": "string",
  "options": ["string", "string", "string", "string"],
  "correctAnswer": "string (must exactly match one of the options)"
}

Return exactly ${safeCount} items in the array.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ message: "AI generation failed", error: errText });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

    // Strip any accidental markdown fences before parsing
    const cleaned = rawText.replace(/```json|```/g, "").trim();

    let generatedQuestions;
    try {
      generatedQuestions = JSON.parse(cleaned);
    } catch (parseError) {
      return res.status(502).json({
        message: "AI returned invalid JSON, please try again",
        raw: rawText,
      });
    }

    if (!Array.isArray(generatedQuestions) || generatedQuestions.length === 0) {
      return res.status(502).json({ message: "AI did not return a valid question list" });
    }

    // Validate each question before saving; skip malformed ones
    const validQuestions = generatedQuestions.filter(
      (q) =>
        q.questionText &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        q.correctAnswer &&
        q.options.includes(q.correctAnswer)
    );

    if (validQuestions.length === 0) {
      return res.status(502).json({ message: "AI returned no valid questions, please try again" });
    }

    // Save as UNPUBLISHED - admin must review before these go live
    const docsToInsert = validQuestions.map((q) => ({
      quizId,
      questionText: q.questionText,
      options: q.options,
      correctAnswer: q.correctAnswer,
      difficulty: safeDifficulty,
      source: "ai",
      isPublished: false,
    }));

    const savedQuestions = await Question.insertMany(docsToInsert);

    res.status(201).json({
      message: `${savedQuestions.length} AI questions generated. Review and publish them before students can see them.`,
      questions: savedQuestions,
    });
  } catch (error) {
    res.status(500).json({ message: "Error generating AI questions", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/admin/ai-questions/pending/:quizId - list unpublished AI questions for review
// ---------------------------------------------
router.get("/pending/:quizId", async (req, res) => {
  try {
    const questions = await Question.find({
      quizId: req.params.quizId,
      source: "ai",
      isPublished: false,
    });
    res.status(200).json(questions);
  } catch (error) {
    res.status(500).json({ message: "Error fetching pending AI questions", error: error.message });
  }
});

// ---------------------------------------------
// PUT /api/admin/ai-questions/bulk-publish - publish all pending AI questions for a quiz
// Body: { quizId }
// Use this AFTER reviewing the pending list via GET /pending/:quizId
// ---------------------------------------------
router.put("/bulk-publish", async (req, res) => {
  try {
    const { quizId } = req.body;

    if (!quizId) {
      return res.status(400).json({ message: "quizId is required" });
    }

    const result = await Question.updateMany(
      { quizId, source: "ai", isPublished: false },
      { isPublished: true }
    );

    const count = await Question.countDocuments({ quizId, isPublished: true });
    await Quiz.findByIdAndUpdate(quizId, { totalQuestions: count });

    res.status(200).json({
      message: `${result.modifiedCount} AI questions published successfully`,
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    res.status(500).json({ message: "Error bulk publishing questions", error: error.message });
  }
});

// ---------------------------------------------
// PUT /api/admin/ai-questions/:id/publish - approve and publish a reviewed AI question
// Admin can edit fields in the same request before publishing.
// ---------------------------------------------
router.put("/:id/publish", async (req, res) => {
  try {
    const { questionText, options, correctAnswer, difficulty } = req.body;

    const updates = { isPublished: true };
    if (questionText) updates.questionText = questionText;
    if (options) updates.options = options;
    if (correctAnswer) updates.correctAnswer = correctAnswer;
    if (difficulty) updates.difficulty = difficulty;

    const question = await Question.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }

    // Keep quiz totalQuestions count accurate
    const count = await Question.countDocuments({ quizId: question.quizId, isPublished: true });
    await Quiz.findByIdAndUpdate(question.quizId, { totalQuestions: count });

    res.status(200).json({ message: "Question published successfully", question });
  } catch (error) {
    res.status(500).json({ message: "Error publishing question", error: error.message });
  }
});

// ---------------------------------------------
// DELETE /api/admin/ai-questions/:id - reject/delete an AI-generated question
// ---------------------------------------------
router.delete("/:id", async (req, res) => {
  try {
    const question = await Question.findByIdAndDelete(req.params.id);
    if (!question) {
      return res.status(404).json({ message: "Question not found" });
    }
    res.status(200).json({ message: "AI question rejected and deleted" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting AI question", error: error.message });
  }
});

export default router;
