import mongoose from "mongoose";

const courseSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    thumbnail: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      default: "General",
    },
    instructorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
    certificateXpRequired: {
      // 0 means no XP requirement - anyone who completes the course can download
      type: Number,
      default: 0,
    },
    visibility: {
      // "public" - shows in student course catalog
      // "private" - hidden from students entirely; only accessible via a
      // multiplayer room code shared by the staff/admin who created it
      type: String,
      enum: ["public", "private"],
      default: "public",
    },
  },
  { timestamps: true }
);

const Course = mongoose.model("Course", courseSchema);

export default Course;
