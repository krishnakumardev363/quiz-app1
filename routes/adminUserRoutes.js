import express from "express";
import User from "../models/User.js";
import { protect, authorizeRoles } from "../middleware/authMiddleware.js";

const router = express.Router();

// Only the super admin can view/manage user roles
router.use(protect, authorizeRoles("admin"));

// ---------------------------------------------
// GET /api/admin/users/search?email=xxx - find a user by email (exact or partial)
// ---------------------------------------------
router.get("/search", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ message: "email query param is required" });
    }

    const users = await User.find({ email: { $regex: email, $options: "i" } })
      .select("name email role xp createdAt")
      .limit(10);

    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ message: "Error searching users", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/admin/users/staff - list all current staff members
// ---------------------------------------------
router.get("/staff", async (req, res) => {
  try {
    const staff = await User.find({ role: "staff" }).select("name email createdAt");
    res.status(200).json(staff);
  } catch (error) {
    res.status(500).json({ message: "Error fetching staff list", error: error.message });
  }
});

// ---------------------------------------------
// PUT /api/admin/users/:id/role - promote/demote a user's role
// Body: { role: "student" | "staff" | "admin" }
// ---------------------------------------------
router.put("/:id/role", async (req, res) => {
  try {
    const { role } = req.body;

    if (!["student", "staff", "admin"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, runValidators: true }
    ).select("name email role");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ message: `${user.name} is now ${role}`, user });
  } catch (error) {
    res.status(500).json({ message: "Error updating user role", error: error.message });
  }
});

export default router;
