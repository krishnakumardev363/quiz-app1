import express from "express";
import PDFDocument from "pdfkit";
import Enrollment from "../models/Enrollment.js";
import Course from "../models/Course.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

// ---------------------------------------------
// GET /api/certificate/:courseId - generate and stream a PDF certificate
// Only available once the user's progress on that course reaches 100%
// ---------------------------------------------
router.get("/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;

    const enrollment = await Enrollment.findOne({ userId: req.user._id, courseId });
    if (!enrollment) {
      return res.status(404).json({ message: "You are not enrolled in this course" });
    }

    if (enrollment.progressPercent < 100) {
      return res.status(400).json({
        message: `Complete the course fully to unlock your certificate. Current progress: ${enrollment.progressPercent}%`,
      });
    }

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // ============ CHARGE XP FOR THE CERTIFICATE (only once, ever) ============
    // Previously this only CHECKED xp >= certificateXpRequired and never
    // actually deducted it, so certificates were effectively free forever
    // once a user crossed the threshold once. Now: if this enrollment
    // hasn't paid yet, verify balance, atomically claim the "paid" flag
    // (prevents double-charging on a double-click/concurrent request), then
    // deduct XP. Already-unlocked certificates redownload for free - you
    // only pay once per course.
    if (course.certificateXpRequired > 0 && !enrollment.certificateUnlocked) {
      if (req.user.xp < course.certificateXpRequired) {
        return res.status(402).json({
          message: `This certificate requires ${course.certificateXpRequired} XP. You currently have ${req.user.xp} XP. Earn more by completing quizzes or buy XP from the XP Store.`,
          xpRequired: course.certificateXpRequired,
          currentXp: req.user.xp,
        });
      }

      const claimed = await Enrollment.findOneAndUpdate(
        { _id: enrollment._id, certificateUnlocked: { $ne: true } },
        { certificateUnlocked: true },
        { new: true }
      );

      // claimed is null if another concurrent request already flipped this
      // flag first (e.g. a double-click) - in that case, skip charging again.
      if (claimed) {
        req.user.xp -= course.certificateXpRequired;
        await req.user.save();
      }
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="certificate-${course.title.replace(/\s+/g, "-")}.pdf"`
    );

    const doc = new PDFDocument({ layout: "landscape", size: "A4", margin: 0 });
    doc.pipe(res);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const centerX = pageWidth / 2;

    // Certificate ID - short, unique-ish, based on user + course + timestamp
    const certId = `QZ-${req.user._id.toString().slice(-6).toUpperCase()}-${courseId
      .toString()
      .slice(-4)
      .toUpperCase()}`;

    // Background wash
    doc.rect(0, 0, pageWidth, pageHeight).fill("#FAFBFF");

    // Outer decorative border (double line)
    doc.rect(24, 24, pageWidth - 48, pageHeight - 48).lineWidth(2.5).stroke("#0066FF");
    doc.rect(32, 32, pageWidth - 64, pageHeight - 64).lineWidth(0.75).stroke("#93C5FD");

    // Corner accents (small squares) for a formal engraved look
    const cornerSize = 14;
    [
      [40, 40],
      [pageWidth - 40 - cornerSize, 40],
      [40, pageHeight - 40 - cornerSize],
      [pageWidth - 40 - cornerSize, pageHeight - 40 - cornerSize],
    ].forEach(([x, y]) => {
      doc.rect(x, y, cornerSize, cornerSize).lineWidth(1.5).stroke("#0066FF");
    });

    // Platform brand
    doc
      .fontSize(20)
      .fillColor("#0066FF")
      .font("Helvetica-Bold")
      .text("QUIZERA", 0, 58, { align: "center", characterSpacing: 3 });

    doc
      .fontSize(9)
      .fillColor("#9CA3AF")
      .font("Helvetica")
      .text("LEARN. QUIZ. ACHIEVE.", 0, 82, { align: "center", characterSpacing: 2 });

    // Title
    doc
      .fontSize(13)
      .fillColor("#111111")
      .font("Helvetica-Bold")
      .text("CERTIFICATE OF COMPLETION", 0, 118, { align: "center", characterSpacing: 2 });

    // Decorative rule under title
    doc
      .moveTo(centerX - 60, 142)
      .lineTo(centerX + 60, 142)
      .lineWidth(1.5)
      .stroke("#0066FF");

    doc
      .fontSize(13)
      .fillColor("#666666")
      .font("Helvetica")
      .text("This certificate is proudly presented to", 0, 160, { align: "center" });

    doc
      .fontSize(34)
      .fillColor("#111111")
      .font("Helvetica-Bold")
      .text(req.user.name, 0, 192, { align: "center" });

    // Underline beneath the name
    const nameWidth = doc.widthOfString(req.user.name, { font: "Helvetica-Bold", fontSize: 34 });
    doc
      .moveTo(centerX - nameWidth / 2 - 10, 234)
      .lineTo(centerX + nameWidth / 2 + 10, 234)
      .lineWidth(1)
      .stroke("#D1D5DB");

    doc
      .fontSize(13)
      .fillColor("#666666")
      .font("Helvetica")
      .text("for successfully completing the course", 0, 250, { align: "center" });

    doc
      .fontSize(21)
      .fillColor("#0066FF")
      .font("Helvetica-Bold")
      .text(course.title, 60, 274, { align: "center", width: pageWidth - 120 });

    // Seal / badge (circle with ribbon-like shape using two triangles)
    const sealX = pageWidth - 150;
    const sealY = pageHeight - 130;
    doc.circle(sealX, sealY, 34).lineWidth(2).stroke("#0066FF");
    doc.circle(sealX, sealY, 27).fillOpacity(1).fill("#0066FF");
    doc
      .fillColor("#FFFFFF")
      .fontSize(9)
      .font("Helvetica-Bold")
      .text("QZ", sealX - 10, sealY - 6, { width: 20, align: "center" });
    // Ribbon tails
    doc
      .moveTo(sealX - 12, sealY + 26)
      .lineTo(sealX - 20, sealY + 50)
      .lineTo(sealX - 4, sealY + 40)
      .closePath()
      .fill("#0066FF");
    doc
      .moveTo(sealX + 12, sealY + 26)
      .lineTo(sealX + 20, sealY + 50)
      .lineTo(sealX + 4, sealY + 40)
      .closePath()
      .fill("#0052CC");

    // Signature line (left side, bottom)
    const sigX = 150;
    const sigY = pageHeight - 100;
    doc.moveTo(sigX - 70, sigY).lineTo(sigX + 70, sigY).lineWidth(1).stroke("#9CA3AF");
    doc
      .fontSize(11)
      .fillColor("#111111")
      .font("Helvetica-Bold")
      .text("Quizera Team", sigX - 70, sigY + 6, { width: 140, align: "center" });
    doc
      .fontSize(8)
      .fillColor("#9CA3AF")
      .font("Helvetica")
      .text("Authorized Signature", sigX - 70, sigY + 20, { width: 140, align: "center" });

    // Issue date + certificate ID (bottom center-left area, below course title)
    doc
      .fontSize(10)
      .fillColor("#9CA3AF")
      .font("Helvetica")
      .text(
        `Issued on ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}`,
        0,
        pageHeight - 60,
        { align: "center" }
      );

    doc
      .fontSize(8)
      .fillColor("#C4C9D4")
      .font("Helvetica")
      .text(`Certificate ID: ${certId}`, 0, pageHeight - 46, { align: "center" });

    doc.end();
  } catch (error) {
    res.status(500).json({ message: "Error generating certificate", error: error.message });
  }
});

export default router;
