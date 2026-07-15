import Enrollment from "../models/Enrollment.js";

// Returns true if this user is allowed to access a course's content
// (subjects, lessons, quizzes):
//  - the course's own instructor (staff previewing their own course)
//  - a super admin (can access anything)
//  - a student/staff with an actual Enrollment record for this course
// Everyone else must enroll first - browsing/reading/quizzing a course you
// never joined is not allowed.
export const hasCourseAccess = async (course, user) => {
  if (user.role === "admin") return true;
  if (course.instructorId.toString() === user._id.toString()) return true;

  const enrollment = await Enrollment.findOne({ userId: user._id, courseId: course._id });
  return !!enrollment;
};
