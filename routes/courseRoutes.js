import express from "express";
import Course from "../models/Course.js";
import Enrollment from "../models/Enrollment.js";
import Subject from "../models/Subject.js";
import Quiz from "../models/Quiz.js";
import Lesson from "../models/Lesson.js";
// import LessonProgress from "../models/LessonProgress.js";
// import Result from "../models/Result.js";
import Result from "../models/Result.js";
import { protect } from "../middleware/authMiddleware.js";
import { hasCourseAccess } from "../utils/courseAccess.js";

const router = express.Router();

router.use(protect);

// ---------------------------------------------
// GET /api/courses - browse all published courses
// ---------------------------------------------
router.get("/", async (req, res) => {
  try {
    const courses = await Course.find({ isPublished: true, visibility: "public" }).sort({
      createdAt: -1,
    });
    res.status(200).json(courses);
  } catch (error) {
    res.status(500).json({ message: "Error fetching courses", error: error.message });
  }
});

// ---------------------------------------------
// POST /api/courses/:id/enroll - enroll logged-in user into a course
// ---------------------------------------------
router.post("/:id/enroll", async (req, res) => {
  try {
    const courseId = req.params.id;

    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    const existing = await Enrollment.findOne({ userId: req.user._id, courseId });
    if (existing) {
      return res.status(400).json({ message: "Already enrolled in this course" });
    }

    const enrollment = await Enrollment.create({
      userId: req.user._id,
      courseId,
      progressPercent: 0,
    });

    res.status(201).json(enrollment);
  } catch (error) {
    res.status(500).json({ message: "Error enrolling in course", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/courses/my-enrollments - logged-in user's enrolled courses with progress
// ---------------------------------------------
router.get("/my-enrollments", async (req, res) => {
  try {
    const enrollments = await Enrollment.find({ userId: req.user._id }).populate("courseId");
    res.status(200).json(enrollments);
  } catch (error) {
    res.status(500).json({ message: "Error fetching enrollments", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/courses/:id - course detail with subjects and quizzes
// ---------------------------------------------
router.get("/:id", async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ message: "Course not found" });
    }

    // Private courses are only visible to their creator or a super admin -
    // regular students only ever reach a private course's quiz via a
    // multiplayer room code, never through normal browsing.
    const isOwner = course.instructorId.toString() === req.user._id.toString();
    const isSuperAdmin = req.user.role === "admin";
    if (course.visibility === "private" && !isOwner && !isSuperAdmin) {
      return res.status(403).json({ message: "This course is private." });
    }

    // ============ ENROLLMENT GATE ============
    // Previously this endpoint returned full subjects/lessons/quizzes to
    // ANY logged-in user, enrolled or not. Now: owner and admin bypass
    // freely (preview/management), everyone else must have actually
    // enrolled first.
    if (!isOwner && !isSuperAdmin) {
      const allowed = await hasCourseAccess(course, req.user);
      if (!allowed) {
        return res.status(403).json({
          message: "Please enroll in this course to view its content.",
          requiresEnrollment: true,
        });
      }
    }

    const subjects = await Subject.find({ courseId: course._id }).sort({ order: 1 });

    // Get logged-in user's best score % for every quiz, so the frontend can mark
    // quizzes as "completed" (passed >=75%) or show best score for retakes.
    const userResults = await Result.find({ userId: req.user._id, courseId: course._id });
    const bestScoreByQuiz = {};
    userResults.forEach((r) => {
      const percent = Math.round((r.correctCount / r.totalQuestions) * 100);
      const qId = r.quizId.toString();
      if (!bestScoreByQuiz[qId] || percent > bestScoreByQuiz[qId]) {
        bestScoreByQuiz[qId] = percent;
      }
    });

    const subjectsWithQuizzes = await Promise.all(
      subjects.map(async (subject) => {
        const lessons = await Lesson.find({ subjectId: subject._id }).sort({ order: 1 });
        const completedLessonIds = await LessonProgress.distinct("lessonId", {
          userId: req.user._id,
          lessonId: { $in: lessons.map((l) => l._id) },
        });
        const completedSet = new Set(completedLessonIds.map((id) => id.toString()));
        const lessonsWithStatus = lessons.map((l) => ({
          ...l.toObject(),
          isRead: completedSet.has(l._id.toString()),
        }));

        const quizzes = await Quiz.find({ subjectId: subject._id }).sort({ order: 1 });
        const quizzesWithStatus = quizzes.map((q) => {
          const bestScore = bestScoreByQuiz[q._id.toString()] ?? null;
          return {
            ...q.toObject(),
            bestScore,
            isCompleted: bestScore !== null && bestScore >= 75,
          };
        });

        const allLessonsRead = lessonsWithStatus.every((l) => l.isRead);

        return {
          ...subject.toObject(),
          lessons: lessonsWithStatus,
          quizzes: quizzesWithStatus,
          allLessonsRead,
        };
      })
    );

    res.status(200).json({ course, subjects: subjectsWithQuizzes });
  } catch (error) {
    res.status(500).json({ message: "Error fetching course detail", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/courses/dashboard/stats - overall stats for logged-in student's dashboard
// ---------------------------------------------
router.get("/dashboard/stats", async (req, res) => {
  try {
    const results = await Result.find({ userId: req.user._id });

    // Count UNIQUE quizzes PASSED (>=75%), not total attempts - retakes and
    // failing attempts shouldn't inflate this number.
    const passedQuizIds = new Set(
      results.filter((r) => r.passed).map((r) => r.quizId.toString())
    );
    const totalCompleted = passedQuizIds.size;

    const avgScore =
      results.length > 0
        ? results.reduce((sum, r) => sum + (r.correctCount / r.totalQuestions) * 100, 0) /
          results.length
        : 0;

    const enrollments = await Enrollment.find({ userId: req.user._id }).populate("courseId");

    res.status(200).json({
      totalCompleted,
      avgScore: Math.round(avgScore),
      xp: req.user.xp,
      streak: req.user.streak,
      badges: req.user.badges,
      enrolledCourseCount: enrollments.length,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching dashboard stats", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/courses/profile/stats - detailed profile data: XP, badges, score trend, weak topics
// ---------------------------------------------
router.get("/profile/stats", async (req, res) => {
  try {
    const results = await Result.find({ userId: req.user._id })
      .populate("quizId", "title difficulty subjectId")
      .sort({ completedAt: 1 });

    // Score trend over time (for a line chart)
    const scoreTrend = results.map((r) => ({
      date: r.completedAt.toISOString().split("T")[0],
      scorePercent: Math.round((r.correctCount / r.totalQuestions) * 100),
    }));

    // Accuracy by quiz title (proxy for "subject" since we don't have subject name here directly)
    const accuracyMap = {};
    results.forEach((r) => {
      const title = r.quizId?.title || "Unknown";
      if (!accuracyMap[title]) {
        accuracyMap[title] = { correct: 0, total: 0 };
      }
      accuracyMap[title].correct += r.correctCount;
      accuracyMap[title].total += r.totalQuestions;
    });

    const accuracyByTopic = Object.entries(accuracyMap).map(([title, data]) => ({
      topic: title,
      accuracy: Math.round((data.correct / data.total) * 100),
    }));

    const weakTopics = accuracyByTopic.filter((t) => t.accuracy < 60).map((t) => t.topic);

    res.status(200).json({
      xp: req.user.xp,
      streak: req.user.streak,
      badges: req.user.badges,
      scoreTrend,
      accuracyByTopic,
      weakTopics,
    });
  } catch (error) {
    res.status(500).json({ message: "Error fetching profile stats", error: error.message });
  }
});

// ---------------------------------------------
// GET /api/courses/lessons/:lessonId - fetch a single lesson's content (any logged-in user)
// ---------------------------------------------
router.get("/lessons/:lessonId", async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    // ============ ENROLLMENT GATE ============
    const subject = await Subject.findById(lesson.subjectId);
    const course = subject ? await Course.findById(subject.courseId) : null;
    if (!course) {
      return res.status(404).json({ message: "Course not found for this lesson" });
    }
    const isOwner = course.instructorId.toString() === req.user._id.toString();
    if (req.user.role !== "admin" && !isOwner) {
      const allowed = await hasCourseAccess(course, req.user);
      if (!allowed) {
        return res.status(403).json({
          message: "Please enroll in this course to view its lessons.",
          requiresEnrollment: true,
        });
      }
    }

    res.status(200).json(lesson);
  } catch (error) {
    res.status(500).json({ message: "Error fetching lesson", error: error.message });
  }
});

// ---------------------------------------------
// POST /api/courses/lessons/:lessonId/complete - mark a lesson as read by the current user
// ---------------------------------------------
router.post("/lessons/:lessonId/complete", async (req, res) => {
  try {
    const lesson = await Lesson.findById(req.params.lessonId);
    if (!lesson) {
      return res.status(404).json({ message: "Lesson not found" });
    }

    // ============ ENROLLMENT GATE ============
    const subject = await Subject.findById(lesson.subjectId);
    const course = subject ? await Course.findById(subject.courseId) : null;
    if (!course) {
      return res.status(404).json({ message: "Course not found for this lesson" });
    }
    const isOwner = course.instructorId.toString() === req.user._id.toString();
    if (req.user.role !== "admin" && !isOwner) {
      const allowed = await hasCourseAccess(course, req.user);
      if (!allowed) {
        return res.status(403).json({
          message: "Please enroll in this course first.",
          requiresEnrollment: true,
        });
      }
    }

    await LessonProgress.findOneAndUpdate(
      { userId: req.user._id, lessonId: lesson._id },
      { completedAt: new Date() },
      { upsert: true, new: true }
    );

    res.status(200).json({ message: "Lesson marked as read" });
  } catch (error) {
    res.status(500).json({ message: "Error marking lesson complete", error: error.message });
  }
});

export default router;
