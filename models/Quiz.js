import mongoose from "mongoose";

const quizSchema = new mongoose.Schema(
  {
    subjectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subject",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    duration: {
      // duration in minutes
      type: Number,
      default: 10,
    },
    totalQuestions: {
      type: Number,
      default: 0,
    },
    negativeMarking: {
      type: Boolean,
      default: false,
    },
    isAIGenerated: {
      type: Boolean,
      default: false,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const Quiz = mongoose.model("Quiz", quizSchema);

export default Quiz;
