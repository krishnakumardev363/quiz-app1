import express from "express";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";
import Enrollment from "../models/Enrollment.js";
import Course from "../models/Course.js";
import { protect } from "../middleware/authMiddleware.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIGNATURE_PATH = path.join(__dirname, "..", "assets", "founder-signature.png");

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
    const certId = `TT-${req.user._id.toString().slice(-6).toUpperCase()}-${courseId
      .toString()
      .slice(-4)
      .toUpperCase()}`;

    // ============ BACKGROUND ============
    doc.rect(0, 0, pageWidth, pageHeight).fill("#FDFCF7");

    // Faint rotated watermark wordmark - classic security-print touch,
    // subtle enough not to compete with the real content.
    doc.save();
    doc.rotate(-32, { origin: [centerX, pageHeight / 2] });
    doc.fontSize(110).font("Helvetica-Bold");
    const watermarkText = "TINORATECH";
    const watermarkWidth = doc.widthOfString(watermarkText, { characterSpacing: 4 });
    doc
      .fillColor("#F0EEE3")
      .text(watermarkText, centerX - watermarkWidth / 2, pageHeight / 2 - 55, {
        lineBreak: false,
        characterSpacing: 4,
      });
    doc.restore();

    // Fine concentric-ring guilloche texture, very low opacity, centered
    // behind the seal area - the kind of fine engraved detail real
    // certificates use, without being visually loud.
    doc.save();
    doc.opacity(0.05);
    for (let r = 10; r <= 90; r += 8) {
      doc.circle(pageWidth - 150, pageHeight - 130, r).lineWidth(0.5).stroke("#0066FF");
    }
    doc.restore();

    // ============ TRIPLE BORDER (gold / navy / gold) ============
    doc.rect(20, 20, pageWidth - 40, pageHeight - 40).lineWidth(1).stroke("#C9A24B");
    doc.rect(27, 27, pageWidth - 54, pageHeight - 54).lineWidth(2.5).stroke("#0B1F44");
    doc.rect(34, 34, pageWidth - 68, pageHeight - 68).lineWidth(0.75).stroke("#C9A24B");

    // ============ ORNAMENTAL CORNER FLOURISHES ============
    // Quarter-circle flourish + small diamond accent at each corner,
    // mirrored appropriately, replacing the old plain squares.
    const drawCornerFlourish = (x, y, flipX, flipY) => {
      const sx = flipX ? -1 : 1;
      const sy = flipY ? -1 : 1;
      doc.save();
      doc.translate(x, y).scale(sx, sy);
      doc
        .moveTo(0, 26)
        .bezierCurveTo(0, 10, 10, 0, 26, 0)
        .lineWidth(1.2)
        .stroke("#C9A24B");
      doc
        .moveTo(0, 16)
        .bezierCurveTo(0, 7, 7, 0, 16, 0)
        .lineWidth(1)
        .stroke("#0B1F44");
      // small diamond accent
      doc
        .moveTo(13, 30)
        .lineTo(17, 34)
        .lineTo(13, 38)
        .lineTo(9, 34)
        .closePath()
        .fill("#C9A24B");
      doc.restore();
    };
    drawCornerFlourish(44, 44, false, false);
    drawCornerFlourish(pageWidth - 44, 44, true, false);
    drawCornerFlourish(44, pageHeight - 44, false, true);
    drawCornerFlourish(pageWidth - 44, pageHeight - 44, true, true);

    // ============ HEADER ORNAMENT ============
    doc.moveTo(centerX - 90, 52).lineTo(centerX - 14, 52).lineWidth(0.75).stroke("#C9A24B");
    doc.moveTo(centerX + 14, 52).lineTo(centerX + 90, 52).lineWidth(0.75).stroke("#C9A24B");
    doc
      .moveTo(centerX, 47)
      .lineTo(centerX + 5, 52)
      .lineTo(centerX, 57)
      .lineTo(centerX - 5, 52)
      .closePath()
      .fill("#C9A24B");

    // Platform brand
    doc
      .fontSize(21)
      .fillColor("#0B1F44")
      .font("Helvetica-Bold")
      .text("TINORATECH", 0, 64, { align: "center", characterSpacing: 3 });

    doc
      .fontSize(9)
      .fillColor("#9CA3AF")
      .font("Helvetica")
      .text("LEARN. QUIZ. ACHIEVE.", 0, 88, { align: "center", characterSpacing: 2 });

    // Title (classic serif for a formal certificate feel)
    doc
      .fontSize(15)
      .fillColor("#0B1F44")
      .font("Times-Bold")
      .text("CERTIFICATE OF COMPLETION", 0, 124, { align: "center", characterSpacing: 2.5 });

    // Decorative rule under title with diamond center
    doc.moveTo(centerX - 70, 150).lineTo(centerX - 8, 150).lineWidth(1).stroke("#C9A24B");
    doc.moveTo(centerX + 8, 150).lineTo(centerX + 70, 150).lineWidth(1).stroke("#C9A24B");
    doc
      .moveTo(centerX, 146)
      .lineTo(centerX + 4, 150)
      .lineTo(centerX, 154)
      .lineTo(centerX - 4, 150)
      .closePath()
      .fill("#C9A24B");

    doc
      .fontSize(13)
      .fillColor("#666666")
      .font("Times-Italic")
      .text("This certificate is proudly presented to", 0, 168, { align: "center" });

    doc
      .fontSize(36)
      .fillColor("#0B1F44")
      .font("Times-Bold")
      .text(req.user.name, 0, 198, { align: "center" });

    // Underline beneath the name
    const nameWidth = doc.widthOfString(req.user.name, { font: "Times-Bold", fontSize: 36 });
    doc
      .moveTo(centerX - nameWidth / 2 - 14, 240)
      .lineTo(centerX + nameWidth / 2 + 14, 240)
      .lineWidth(1)
      .stroke("#C9A24B");

    doc
      .fontSize(13)
      .fillColor("#666666")
      .font("Times-Italic")
      .text("for successfully completing the course", 0, 256, { align: "center" });

    doc
      .fontSize(22)
      .fillColor("#0066FF")
      .font("Times-Bold")
      .text(course.title, 60, 280, { align: "center", width: pageWidth - 120 });

    // ============ GOLD MEDALLION SEAL, laurel-framed ============
    const sealX = pageWidth - 150;
    const sealY = pageHeight - 130;

    // Laurel leaves - small ellipses arranged along a curve on each side
    const drawLaurel = (mirror) => {
      const s = mirror ? -1 : 1;
      for (let i = 0; i < 7; i++) {
        const angle = (Math.PI / 2.6) * (i / 6) + Math.PI / 2.3;
        const lx = sealX + s * (44 + i * 3.2) * Math.cos(angle - Math.PI / 2);
        const ly = sealY + (44 + i * 3.2) * Math.sin(angle - Math.PI / 2) + 6;
        doc.save();
        doc.translate(lx, ly).rotate(s * (30 + i * 6));
        doc.ellipse(0, 0, 6, 2.4).fill("#C9A24B");
        doc.restore();
      }
    };
    drawLaurel(false);
    drawLaurel(true);

    doc.circle(sealX, sealY, 34).lineWidth(2).stroke("#C9A24B");
    doc.circle(sealX, sealY, 29).lineWidth(1).stroke("#0B1F44");
    doc.circle(sealX, sealY, 25).fillOpacity(1).fill("#0B1F44");
    doc
      .fillColor("#C9A24B")
      .fontSize(11)
      .font("Times-Bold")
      .text("TT", sealX - 12, sealY - 7, { width: 24, align: "center" });
    // Ribbon tails
    doc
      .moveTo(sealX - 12, sealY + 26)
      .lineTo(sealX - 20, sealY + 50)
      .lineTo(sealX - 4, sealY + 40)
      .closePath()
      .fill("#0B1F44");
    doc
      .moveTo(sealX + 12, sealY + 26)
      .lineTo(sealX + 20, sealY + 50)
      .lineTo(sealX + 4, sealY + 40)
      .closePath()
      .fill("#C9A24B");

    // ============ SIGNATURE BLOCK ============
    const sigX = 150;
    const sigY = pageHeight - 100;

    const sigImgWidth = 120;
    const sigImgAspect = 630 / 1455; // height/width of the real founder signature PNG
    const sigImgHeight = sigImgWidth * sigImgAspect;
    doc.image(SIGNATURE_PATH, sigX - sigImgWidth / 2, sigY - sigImgHeight - 4, {
      width: sigImgWidth,
      height: sigImgHeight,
    });

    doc.moveTo(sigX - 70, sigY).lineTo(sigX + 70, sigY).lineWidth(1).stroke("#C9A24B");
    doc
      .fontSize(11)
      .fillColor("#0B1F44")
      .font("Times-Bold")
      .text("CEO & Founder", sigX - 70, sigY + 6, { width: 140, align: "center" });
    doc
      .fontSize(8)
      .fillColor("#9CA3AF")
      .font("Helvetica")
      .text("Tinoratech", sigX - 70, sigY + 20, { width: 140, align: "center" });

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