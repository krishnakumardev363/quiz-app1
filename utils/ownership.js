import Course from "../models/Course.js";
import Subject from "../models/Subject.js";
import Quiz from "../models/Quiz.js";

// ============ OWNERSHIP CHAIN-WALKING HELPERS ============
// Every piece of course content (Subject -> Lesson/Quiz -> Question) needs
// to trace back to its parent Course to check who's allowed to touch it.
// These helpers centralize that chain-walk so every nested admin route
// checks ownership the same, correct way instead of not checking at all.

// True if this user is allowed to manage (create/edit/delete content in)
// this course: its own instructor, or a super admin.
export const canManageCourse = (course, user) => {
  if (!course) return false;
  if (user.role === "admin") return true;
  const ownerId = course.instructorId?._id
    ? course.instructorId._id.toString()
    : course.instructorId.toString();
  return ownerId === user._id.toString();
};

// Resolve the Course a Subject belongs to.
export const getCourseForSubject = async (subjectId) => {
  const subject = await Subject.findById(subjectId);
  if (!subject) return null;
  return Course.findById(subject.courseId);
};

// Resolve the Course a Quiz belongs to (walks Quiz -> Subject -> Course).
export const getCourseForQuiz = async (quizId) => {
  const quiz = await Quiz.findById(quizId);
  if (!quiz) return null;
  return getCourseForSubject(quiz.subjectId);
};
