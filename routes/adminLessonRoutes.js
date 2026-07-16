import express from "express";
import Lesson from "../models/Lesson.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";
import { canManageCourse, getCourseForSubject } from "../utils/ownership.js";

const router = express.Router();

router.use(protect, authorizeRoles("admin", "staff"));

// ---------------------------------------------
// POST /api/admin/lessons - create a lesson manually
// ---------------------------------------------
router.post("/", async (req, res) => {
  try {
    const { subjectId, title, content, order } = req.body;

    if (!subjectId || !title || !content) {
      return res.status(400).json({ message: "subjectId, title and content are required" });
    }

    // ============ OWNERSHIP CHECK ============
    const course = await getCourseForSubject(subjectId);
    if (!course) {
      return res.status(404).json({ message: "Course not found for this subject" });
    }
    if (!canManageCourse(course, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
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
    // ============ OWNERSHIP CHECK ============
    const course = await getCourseForSubject(req.params.subjectId);
    if (!course) {
      return res.status(404).json({ message: "Course not found for this subject" });
    }
    if (!canManageCourse(course, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
    }

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
    const existing = await Lesson.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    // ============ OWNERSHIP CHECK ============
    const course = await getCourseForSubject(existing.subjectId);
    if (!canManageCourse(course, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
    }

    const lesson = await Lesson.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
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
    const existing = await Lesson.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    // ============ OWNERSHIP CHECK ============
    const course = await getCourseForSubject(existing.subjectId);
    if (!canManageCourse(course, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
    }

    await Lesson.findByIdAndDelete(req.params.id);
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

    // ============ OWNERSHIP CHECK ============
    const course = await getCourseForSubject(subjectId);
    if (!course) {
      return res.status(404).json({ message: "Course not found for this subject" });
    }
    if (!canManageCourse(course, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
    }

    // ============ TOPIC LENGTH GUARD ============
    // "topic" is meant to be a short subject like "What is Data Science".
    // Without a cap, someone can paste an entire multi-lesson generation
    // prompt in here, which then gets embedded into the Gemini prompt
    // below and frequently gets echoed back verbatim inside the response -
    // corrupting the saved lesson content with duplicated prompt text.
    const trimmedTopic = topic.trim();
    if (trimmedTopic.length > 150) {
      return res.status(400).json({
        message:
          "Topic is too long (max 150 characters). Enter a short topic like \"What is Data Science\", not full instructions - this field only generates ONE lesson at a time.",
      });
    }

    const prompt = `Write clear, well-structured study material for students on the topic: "${trimmedTopic}".

Format it in plain text with:
- A short introduction (2-3 sentences)
- 3-5 key concepts, each with a short heading on its own line and a 2-4 sentence explanation
- If the topic is a programming/technical topic, include short code examples wrapped in triple backticks like this:
\`\`\`
age = 30
name = "Alice"
price = 19.99
\`\`\`
  Each statement or line of code must be on its own line inside the backticks - never join multiple lines of code into one line.
- A brief summary at the end

Do not use markdown symbols like # or ** for headings or emphasis - just short plain lines for headings. Only use triple backticks, and only for actual code blocks. Keep the total length moderate (around 300-500 words of prose, excluding code) - concise enough for a student to read in a few minutes.

IMPORTANT: Do not repeat, restate, quote, or reference this instruction or the topic string itself anywhere in your output. Output ONLY the finished study material text - no preamble, no "Here is the study material for...", no echoing the topic or these instructions.`;

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
      title: trimmedTopic,
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
