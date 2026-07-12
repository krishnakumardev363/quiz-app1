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
      // ============ RECEIPT LENGTH FIX ============
      // Razorpay's `receipt` field has a hard 40-character limit. The old
      // version (`xp_` + full 24-char ObjectId + `_` + 13-digit timestamp)
      // was 41 characters - 1 over the limit - so every single order
      // creation was rejected by Razorpay's API. Using the last 6 hex
      // chars of the ObjectId keeps this well under 40 while still being
      // unique enough per user+timestamp for a reference id.
      receipt: `xp_${req.user._id.toString().slice(-6)}_${Date.now()}`,
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
    console.error("Razorpay create-order failed:", error);
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

    // ============ TIMING-SAFE SIGNATURE COMPARISON ============
    // crypto.timingSafeEqual instead of !== avoids leaking timing
    // information about how many leading characters matched.
    const expectedBuffer = Buffer.from(expectedSignature);
    const providedBuffer = Buffer.from(razorpay_signature);
    const signatureValid =
      expectedBuffer.length === providedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, providedBuffer);

    if (!signatureValid) {
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

    // ============ OWNERSHIP CHECK ============
    // Defense-in-depth: even though a valid signature already proves this
    // payment is genuine, also confirm the order actually belongs to
    // whoever is currently logged in before crediting XP to their account.
    if (purchase.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "This order does not belong to your account" });
    }

    if (purchase.status === "paid") {
      return res.status(400).json({ message: "This order has already been processed" });
    }

    purchase.status = "paid";
    purchase.razorpayPaymentId = razorpay_payment_id;
    await purchase.save();

    // Credit the purchase's own owner explicitly (now guaranteed to be
    // req.user thanks to the ownership check above, but stated explicitly
    // rather than relying on req.user for clarity).
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
