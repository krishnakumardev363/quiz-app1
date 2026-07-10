import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { protect } from "../middleware/authMiddleware.js";
import { generateOtp, sendOtpEmail } from "../utils/sendEmail.js";

const router = express.Router();

const OTP_EXPIRY_MINUTES = 10;

// Detect if we're running behind a real HTTPS deployment (Render + Netlify
// are always on different origins) rather than trusting NODE_ENV, since
// hosting platforms don't always set NODE_ENV=production automatically.
// This is the single most common cause of "auth works over normal requests
// but silently fails during the Socket.io handshake" - the cookie was never
// sent cross-site in the first place because SameSite=Lax blocks it.
const isCrossOriginDeployment = (process.env.CLIENT_URL || "").startsWith("https://");

// Helper: generate JWT and set as HTTP-only cookie
const generateTokenAndSetCookie = (res, userId) => {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.cookie("token", token, {
    httpOnly: true,
    secure: isCrossOriginDeployment,
    sameSite: isCrossOriginDeployment ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

// ---------------------------------------------
// POST /api/auth/signup - creates unverified user, sends OTP
// ---------------------------------------------
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Please fill all required fields" });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role: role === "admin" ? "admin" : "student",
      isVerified: false,
      otp,
      otpExpiry,
    });

    await sendOtpEmail({ to: user.email, name: user.name, otp, purpose: "signup" });

    res.status(201).json({
      message: "Signup successful. Please check your email for the OTP to verify your account.",
      email: user.email,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error during signup", error: error.message });
  }
});

// ---------------------------------------------
// POST /api/auth/verify-otp - verify signup OTP, then logs user in
// ---------------------------------------------
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: "Account already verified" });
    }

    if (user.otp !== otp || !user.otpExpiry || user.otpExpiry < new Date()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.isVerified = true;
    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    generateTokenAndSetCookie(res, user._id);

    res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      xp: user.xp,
      streak: user.streak,
      badges: user.badges,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error during OTP verification", error: error.message });
  }
});

// ---------------------------------------------
// POST /api/auth/resend-otp - resend signup OTP
// ---------------------------------------------
router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isVerified) {
      return res.status(400).json({ message: "Account already verified" });
    }

    const otp = generateOtp();
    user.otp = otp;
    user.otpExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await user.save();

    await sendOtpEmail({ to: user.email, name: user.name, otp, purpose: "signup" });

    res.status(200).json({ message: "OTP resent successfully" });
  } catch (error) {
    res.status(500).json({ message: "Server error while resending OTP", error: error.message });
  }
});

// ---------------------------------------------
// POST /api/auth/login - normal login, no OTP (must be verified)
// ---------------------------------------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Please provide email and password" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        message: "Account not verified. Please verify the OTP sent to your email.",
        email: user.email,
      });
    }

    generateTokenAndSetCookie(res, user._id);

    res.status(200).json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      xp: user.xp,
      streak: user.streak,
      badges: user.badges,
    });
  } catch (error) {
    res.status(500).json({ message: "Server error during login", error: error.message });
  }
});

// ---------------------------------------------
// POST /api/auth/forgot-password - sends OTP to reset password
// ---------------------------------------------
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: "No account found with this email" });
    }

    const otp = generateOtp();
    user.resetPasswordOtp = otp;
    user.resetPasswordExpiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
    await user.save();

    await sendOtpEmail({ to: user.email, name: user.name, otp, purpose: "reset" });

    res.status(200).json({ message: "OTP sent to your email for password reset" });
  } catch (error) {
    res.status(500).json({ message: "Server error during forgot password", error: error.message });
  }
});

// ---------------------------------------------
// POST /api/auth/reset-password - verify OTP + set new password
// ---------------------------------------------
router.post("/reset-password", async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: "Email, OTP and new password are required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (
      user.resetPasswordOtp !== otp ||
      !user.resetPasswordExpiry ||
      user.resetPasswordExpiry < new Date()
    ) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetPasswordOtp = null;
    user.resetPasswordExpiry = null;
    await user.save();

    res.status(200).json({ message: "Password reset successful. Please login with your new password." });
  } catch (error) {
    res.status(500).json({ message: "Server error during password reset", error: error.message });
  }
});

// ---------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------
router.post("/logout", (req, res) => {
  res.cookie("token", "", {
    httpOnly: true,
    secure: isCrossOriginDeployment,
    sameSite: isCrossOriginDeployment ? "none" : "lax",
    expires: new Date(0),
  });
  res.status(200).json({ message: "Logged out successfully" });
});

// ---------------------------------------------
// PUT /api/auth/update-profile - update logged-in user's name
// ---------------------------------------------
router.put("/update-profile", protect, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Name is required" });
    }

    req.user.name = name.trim();
    await req.user.save();

    res.status(200).json({
      _id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      xp: req.user.xp,
      streak: req.user.streak,
      badges: req.user.badges,
    });
  } catch (error) {
    res.status(500).json({ message: "Error updating profile", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/auth/me - get current logged-in user
// ---------------------------------------------
router.get("/me", protect, async (req, res) => {
  res.status(200).json(req.user);
});

// ---------------------------------------------
// PUT /api/auth/update-profile - update logged-in user's name
// ---------------------------------------------
router.put("/update-profile", protect, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Name cannot be empty" });
    }

    req.user.name = name.trim();
    await req.user.save();

    res.status(200).json({
      _id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      xp: req.user.xp,
      streak: req.user.streak,
      badges: req.user.badges,
    });
  } catch (error) {
    res.status(500).json({ message: "Error updating profile", error: error.message });
  }
});

export default router;
