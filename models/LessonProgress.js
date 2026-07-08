import mongoose from "mongoose";

const lessonProgressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lessonId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lesson",
      required: true,
    },
    completedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// A user can only have one completion record per lesson
lessonProgressSchema.index({ userId: 1, lessonId: 1 }, { unique: true });

const LessonProgress = mongoose.model("LessonProgress", lessonProgressSchema);

export default LessonProgress;
