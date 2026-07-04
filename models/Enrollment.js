import mongoose from "mongoose";

const enrollmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
    },
    progressPercent: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Prevent duplicate enrollment for the same user + course
enrollmentSchema.index({ userId: 1, courseId: 1 }, { unique: true });

const Enrollment = mongoose.model("Enrollment", enrollmentSchema);

export default Enrollment;
