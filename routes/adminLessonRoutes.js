import express from "express";
import Lesson from "../models/Lesson.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, authorizeRoles("admin"));

// ---------------------------------------------
// POST /api/admin/lessons - create a lesson manually
// ---------------------------------------------
router.post("/", async (req, res) => {
  try {
    const { subjectId, title, content, order } = req.body;

    if (!subjectId || !title || !content) {
      return res.status(400).json({ message: "subjectId, title and content are required" });
    }

    const lesson = await Lesson.create({
      subjectId,
      title,
      content,
      order,
      source: "manual",
    });

    res.status(201).json(lesson);
  } catch (error) {
    res.status(500).json({ message: "Error creating lesson", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/admin/lessons/subject/:subjectId - list lessons for a subject
// ---------------------------------------------
router.get("/subject/:subjectId", async (req, res) => {
  try {
    const lessons = await Lesson.find({ subjectId: req.params.subjectId }).sort({ order: 1 });
    res.status(200).json(lessons);
  } catch (error) {
    res.status(500).json({ message: "Error fetching lessons", error: error.message });
  }
});

// ---------------------------------------------
// PUT /api/admin/lessons/:id - update a lesson (also used to edit AI-generated content)
// ---------------------------------------------
router.put("/:id", async (req, res) => {
  try {
    const lesson = await Lesson.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!lesson) {
      return res.status(404).json({ message: "Lesson not found" });
    }
    res.status(200).json(lesson);
  } catch (error) {
    res.status(500).json({ message: "Error updating lesson", error: error.message });
  }
});

// ---------------------------------------------
// DELETE /api/admin/lessons/:id
// ---------------------------------------------
router.delete("/:id", async (req, res) => {
  try {
    const lesson = await Lesson.findByIdAndDelete(req.params.id);
    if (!lesson) {
      return res.status(404).json({ message: "Lesson not found" });
    }
    res.status(200).json({ message: "Lesson deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting lesson", error: error.message });
  }
});

// ---------------------------------------------
// POST /api/admin/lessons/generate-ai - generate lesson content with Gemini
// Body: { subjectId, topic }
// ---------------------------------------------
router.post("/generate-ai", async (req, res) => {
  try {
    const { subjectId, topic } = req.body;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        message: "AI content generation is not configured yet. Add GEMINI_API_KEY to your .env file.",
      });
    }

    if (!subjectId || !topic) {
      return res.status(400).json({ message: "subjectId and topic are required" });
    }

    const prompt = `Write clear, well-structured study material for students on the topic: "${topic}".

Format it in plain text with:
- A short introduction (2-3 sentences)
- 3-5 key concepts, each with a short heading and a 2-4 sentence explanation
- A brief summary at the end

Do not use markdown symbols like # or **. Keep it readable as plain paragraphs with line breaks between sections. Keep the total length moderate (around 300-500 words) - concise enough for a student to read in a few minutes.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
    const content = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";

    if (!content.trim()) {
      return res.status(502).json({ message: "AI did not return any content, please try again" });
    }

    const lesson = await Lesson.create({
      subjectId,
      title: topic,
      content: content.trim(),
      source: "ai",
    });

    res.status(201).json({
      message: "Lesson content generated successfully. You can edit it before publishing to students.",
      lesson,
    });
  } catch (error) {
    res.status(500).json({ message: "Error generating lesson content", error: error.message });
  }
});

export default router;
