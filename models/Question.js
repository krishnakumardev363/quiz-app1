import mongoose from "mongoose";

const questionSchema = new mongoose.Schema(
  {
    quizId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quiz",
      required: true,
    },
    questionText: {
      type: String,
      required: true,
    },
    options: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => arr.length >= 2,
        message: "A question must have at least 2 options",
      },
    },
    correctAnswer: {
      type: String,
      required: true,
    },
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
    source: {
      type: String,
      enum: ["manual", "ai"],
      default: "manual",
    },
    isPublished: {
      // AI generated questions default to false until admin reviews
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const Question = mongoose.model("Question", questionSchema);

export default Question;
