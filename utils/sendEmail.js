import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

// Generate a 6-digit OTP
export const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Send OTP email (used for signup verification and forgot password)
export const sendOtpEmail = async ({ to, name, otp, purpose }) => {
  const subject =
    purpose === "reset"
      ? "Reset your password - OTP"
      : "Verify your account - OTP";

  const heading =
    purpose === "reset" ? "Reset Your Password" : "Verify Your Account";

  const message =
    purpose === "reset"
      ? "Use the OTP below to reset your password. This code expires in 10 minutes."
      : "Use the OTP below to verify your account. This code expires in 10 minutes.";

  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "QuizApp <onboarding@resend.dev>",
      to,
      subject,
      html: `
        <div style="font-family: Inter, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border-radius: 12px; border: 1px solid #e5e7eb;">
          <h2 style="color: #0066FF; margin-bottom: 8px;">${heading}</h2>
          <p style="color: #333;">Hi ${name || "there"},</p>
          <p style="color: #333;">${message}</p>
          <div style="background: #f0f5ff; border-radius: 8px; padding: 16px; text-align: center; margin: 16px 0;">
            <span style="font-size: 28px; font-weight: bold; letter-spacing: 4px; color: #0066FF;">${otp}</span>
          </div>
          <p style="color: #888; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
      `,
    });
    return true;
  } catch (error) {
    console.error("Resend email error:", error.message);
    return false;
  }
};
