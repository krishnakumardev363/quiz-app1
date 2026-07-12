import express from "express";
import Subject from "../models/Subject.js";
import Course from "../models/Course.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";
import { canManageCourse, getCourseForSubject } from "../utils/ownership.js";

const router = express.Router();

router.use(protect, authorizeRoles("admin", "staff"));

// POST /api/admin/subjects - create subject
router.post("/", async (req, res) => {
  try {
    const { courseId, title, order } = req.body;

    if (!courseId || !title) {
      return res.status(400).json({ message: "courseId and title are required" });
    }

    // ============ OWNERSHIP CHECK ============
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    if (!canManageCourse(course, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
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
    const course = await Course.findById(req.params.courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    if (!canManageCourse(course, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
    }

    const subjects = await Subject.find({ courseId: req.params.courseId }).sort({ order: 1 });
    res.status(200).json(subjects);
  } catch (error) {
    res.status(500).json({ message: "Error fetching subjects", error: error.message });
  }
});

// PUT /api/admin/subjects/:id - update subject
router.put("/:id", async (req, res) => {
  try {
    // ============ OWNERSHIP CHECK ============
    const existing = await Subject.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Subject not found" });
    }
    const course = await Course.findById(existing.courseId);
    if (!canManageCourse(course, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
    }

    const subject = await Subject.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    res.status(200).json(subject);
  } catch (error) {
    res.status(500).json({ message: "Error updating subject", error: error.message });
  }
});

// DELETE /api/admin/subjects/:id - delete subject
router.delete("/:id", async (req, res) => {
  try {
    // ============ OWNERSHIP CHECK ============
    const existing = await Subject.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Subject not found" });
    }
    const course = await Course.findById(existing.courseId);
    if (!canManageCourse(course, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
    }

    await Subject.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Subject deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting subject", error: error.message });
  }
});

export default router;
