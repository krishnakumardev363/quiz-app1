import express from "express";
import crypto from "crypto";
import Razorpay from "razorpay";
import XpPurchase from "../models/XpPurchase.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

// Fixed XP packages - price scales at a constant Rs 0.8 per XP
const XP_PACKAGES = [
  { id: "xp_100", amountInr: 80, xp: 100 },
  { id: "xp_200", amountInr: 160, xp: 200 },
  { id: "xp_300", amountInr: 240, xp: 300 },
  { id: "xp_500", amountInr: 400, xp: 500 },
  { id: "xp_750", amountInr: 600, xp: 750 },
  { id: "xp_1000", amountInr: 800, xp: 1000 },
];

const getRazorpayInstance = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return null;
  console.log("Razorpay instance created with key_id:", process.env.RAZORPAY_KEY_ID);
  console.log("Razorpay instance created with key_secret:", process.env.RAZORPAY_KEY_SECRET);
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

// ---------------------------------------------
// GET /api/xp-store/packages - list available XP packages
// ---------------------------------------------
router.get("/packages", (req, res) => {
  res.status(200).json(XP_PACKAGES);
});

// ---------------------------------------------
// POST /api/xp-store/create-order - create a Razorpay order for a package
// ---------------------------------------------
router.post("/create-order", async (req, res) => {
  try {
    const razorpay = getRazorpayInstance();
    if (!razorpay) {
      return res.status(503).json({
        message: "Payments are not configured yet. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.",
      });
    }

    const { packageId } = req.body;
    const pkg = XP_PACKAGES.find((p) => p.id === packageId);
    if (!pkg) {
      return res.status(400).json({ message: "Invalid package selected" });
    }

    const order = await razorpay.orders.create({
      amount: pkg.amountInr * 100, // paise
      currency: "INR",
      receipt: `xp_${req.user._id}_${Date.now()}`,
    });

    await XpPurchase.create({
      userId: req.user._id,
      amountInr: pkg.amountInr,
      xpPurchased: pkg.xp,
      razorpayOrderId: order.id,
      status: "created",
    });

    res.status(200).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      package: pkg,
    });
  } catch (error) {
    res.status(500).json({ message: "Error creating payment order", error: error.message });
  }
});

// ---------------------------------------------
// POST /api/xp-store/verify-payment - verify Razorpay signature, then credit XP
// ---------------------------------------------
router.post("/verify-payment", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: "Missing payment verification details" });
    }

    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      await XpPurchase.findOneAndUpdate(
        { razorpayOrderId: razorpay_order_id },
        { status: "failed" }
      );
      return res.status(400).json({ message: "Payment verification failed" });
    }

    const purchase = await XpPurchase.findOne({ razorpayOrderId: razorpay_order_id });
    if (!purchase) {
      return res.status(404).json({ message: "Order not found" });
    }
    if (purchase.status === "paid") {
      return res.status(400).json({ message: "This order has already been processed" });
    }

    purchase.status = "paid";
    purchase.razorpayPaymentId = razorpay_payment_id;
    await purchase.save();

    req.user.xp += purchase.xpPurchased;
    await req.user.save();

    res.status(200).json({
      message: `${purchase.xpPurchased} XP added to your account!`,
      newXp: req.user.xp,
    });
  } catch (error) {
    res.status(500).json({ message: "Error verifying payment", error: error.message });
  }
});

export default router;
