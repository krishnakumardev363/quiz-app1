import mongoose from "mongoose";

const lessonSchema = new mongoose.Schema(
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
    content: {
      // Plain text / markdown-style study material
      type: String,
      required: true,
    },
    order: {
      type: Number,
      default: 0,
    },
    source: {
      type: String,
      enum: ["manual", "ai"],
      default: "manual",
    },
  },
  { timestamps: true }
);

const Lesson = mongoose.model("Lesson", lessonSchema);

export default Lesson;
