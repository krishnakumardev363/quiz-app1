import express from "express";
import Course from "../models/Course.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// All routes below require admin login
router.use(protect, authorizeRoles("admin"));

// POST /api/admin/courses - create course
router.post("/", async (req, res) => {
  try {
    const { title, description, thumbnail, category } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Title is required" });
    }

    const course = await Course.create({
      title,
      description,
      thumbnail,
      category,
      instructorId: req.user._id,
    });

    res.status(201).json(course);
  } catch (error) {
    res.status(500).json({ message: "Error creating course", error: error.message });
  }
});

// GET /api/admin/courses - list all courses
router.get("/", async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    res.status(200).json(courses);
  } catch (error) {
    res.status(500).json({ message: "Error fetching courses", error: error.message });
  }
});

// GET /api/admin/courses/:id - get single course
router.get("/:id", async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    res.status(200).json(course);
  } catch (error) {
    res.status(500).json({ message: "Error fetching course", error: error.message });
  }
});

// PUT /api/admin/courses/:id - update course
router.put("/:id", async (req, res) => {
  try {
    const course = await Course.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    res.status(200).json(course);
  } catch (error) {
    res.status(500).json({ message: "Error updating course", error: error.message });
  }
});

// DELETE /api/admin/courses/:id - delete course
router.delete("/:id", async (req, res) => {
  try {
    const course = await Course.findByIdAndDelete(req.params.id);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    res.status(200).json({ message: "Course deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting course", error: error.message });
  }
});

export default router;
