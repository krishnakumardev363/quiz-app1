import express from "express";
import Subject from "../models/Subject.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect, authorizeRoles("admin"));

// POST /api/admin/subjects - create subject
router.post("/", async (req, res) => {
  try {
    const { courseId, title, order } = req.body;

    if (!courseId || !title) {
      return res.status(400).json({ message: "courseId and title are required" });
    }

    const subject = await Subject.create({ courseId, title, order });
    res.status(201).json(subject);
  } catch (error) {
    res.status(500).json({ message: "Error creating subject", error: error.message });
  }
});

// GET /api/admin/subjects/course/:courseId - list subjects for a course
router.get("/course/:courseId", async (req, res) => {
  try {
    const subjects = await Subject.find({ courseId: req.params.courseId }).sort({ order: 1 });
    res.status(200).json(subjects);
  } catch (error) {
    res.status(500).json({ message: "Error fetching subjects", error: error.message });
  }
});

// PUT /api/admin/subjects/:id - update subject
router.put("/:id", async (req, res) => {
  try {
    const subject = await Subject.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!subject) {
      return res.status(404).json({ message: "Subject not found" });
    }
    res.status(200).json(subject);
  } catch (error) {
    res.status(500).json({ message: "Error updating subject", error: error.message });
  }
});

// DELETE /api/admin/subjects/:id - delete subject
router.delete("/:id", async (req, res) => {
  try {
    const subject = await Subject.findByIdAndDelete(req.params.id);
    if (!subject) {
      return res.status(404).json({ message: "Subject not found" });
    }
    res.status(200).json({ message: "Subject deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting subject", error: error.message });
  }
});

export default router;
