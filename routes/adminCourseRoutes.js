import express from "express";
import Course from "../models/Course.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Staff and admin can both manage courses. Staff can only see/edit their
// OWN courses; admin (super admin) can see and manage everything.
router.use(protect, authorizeRoles("admin", "staff"));

// Helper: verify the requesting user owns this course, unless they're admin
// const canManageCourse = (course, user) => {
//   if (user.role === "admin") return true;
//   return course.instructorId.toString() === user._id.toString();
// };
// Helper: verify the requesting user owns this course, unless they're admin.
// Handles instructorId whether it's a raw ObjectId or a populated subdocument
// (e.g. after .populate("instructorId", "name")).
const canManageCourse = (course, user) => {
  if (user.role === "admin") return true;
  const ownerId = course.instructorId?._id
    ? course.instructorId._id.toString()
    : course.instructorId.toString();
  return ownerId === user._id.toString();
};
// POST /api/admin/courses - create course
router.post("/", async (req, res) => {
  try {
    const { title, description, thumbnail, category, certificateXpRequired, visibility } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Title is required" });
    }

    const course = await Course.create({
      title,
      description,
      thumbnail,
      category,
      instructorId: req.user._id,
      certificateXpRequired: Number(certificateXpRequired) || 0,
      visibility: visibility === "private" ? "private" : "public",
    });

    res.status(201).json(course);
  } catch (error) {
    res.status(500).json({ message: "Error creating course", error: error.message });
  }
});

// GET /api/admin/courses - list courses (staff sees only their own, admin sees all)
router.get("/", async (req, res) => {
  try {
    const filter = req.user.role === "admin" ? {} : { instructorId: req.user._id };
    const courses = await Course.find(filter)
      .populate("instructorId", "name")
      .sort({ createdAt: -1 });
    res.status(200).json(courses);
  } catch (error) {
    res.status(500).json({ message: "Error fetching courses", error: error.message });
  }
});
// // adminCourseRoutes.js
// router.get("/:id", async (req, res) => {
//   try {
//     const course = await Course.findById(req.params.id).populate("instructorId", "name");
//     //                                                    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//     if (!course) {
//       return res.status(404).json({ message: "Course not found" });
//     }
//     if (!canManageCourse(course, req.user)) {   // ← this always fails for staff now
//       return res.status(403).json({ message: "You don't have access to this course" });
//     }
//   } catch (error) {
//     res.status(500).json({ message: "Error fetching course", error: error.message });
//   }
// });

// GET /api/admin/courses/:id - get single course
router.get("/:id", async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate("instructorId", "name");
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }
    if (!canManageCourse(course, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
    }
    res.status(200).json(course);
  } catch (error) {
    res.status(500).json({ message: "Error fetching course", error: error.message });
  }
});

// PUT /api/admin/courses/:id - update course
router.put("/:id", async (req, res) => {
  try {
    const existing = await Course.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Course not found" });
    }
    if (!canManageCourse(existing, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
    }

    const course = await Course.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    res.status(200).json(course);
  } catch (error) {
    res.status(500).json({ message: "Error updating course", error: error.message });
  }
});

// DELETE /api/admin/courses/:id - delete course
router.delete("/:id", async (req, res) => {
  try {
    const existing = await Course.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "Course not found" });
    }
    if (!canManageCourse(existing, req.user)) {
      return res.status(403).json({ message: "You don't have access to this course" });
    }

    await Course.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Course deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting course", error: error.message });
  }
});

export default router;
