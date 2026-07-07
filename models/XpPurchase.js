import mongoose from "mongoose";

const xpPurchaseSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amountInr: {
      type: Number,
      required: true,
    },
    xpPurchased: {
      type: Number,
      required: true,
    },
    razorpayOrderId: {
      type: String,
      required: true,
    },
    razorpayPaymentId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["created", "paid", "failed"],
      default: "created",
    },
  },
  { timestamps: true }
);

const XpPurchase = mongoose.model("XpPurchase", xpPurchaseSchema);

export default XpPurchase;
