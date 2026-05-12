// import mongoose from "mongoose";

// // ─── User schema ──────────────────────────────────────────────────────────────
// // Stores a user's coding history — topics attempted, correct, scores
// const topicSchema = new mongoose.Schema({
//   name:      { type: String, required: true },
//   attempted: { type: Number, default: 0 },
//   correct:   { type: Number, default: 0 },
// });

// const userSchema = new mongoose.Schema({
//   userId:         { type: String, required: true, unique: true },
//   solvedProblems: { type: Number, default: 0 },
//   topics:         [topicSchema],
//   createdAt:      { type: Date, default: Date.now },
// });

// export const User = mongoose.model("User", userSchema);

// // ─── Plan schema ──────────────────────────────────────────────────────────────
// // Stores the generated preparation plan for a user
// const taskSchema = new mongoose.Schema({
//   day:      Number,
//   focus:    String,
//   accuracy: Number,
//   tasks:    [String],
// });

// const planSchema = new mongoose.Schema({
//   userId:    { type: String, required: true },
//   goal:      { type: String, required: true },
//   totalDays: { type: Number, default: 30 },
//   plan:      [taskSchema],
//   createdAt: { type: Date, default: Date.now },
// });

// export const Plan = mongoose.model("Plan", planSchema);

// // ─── Progress schema ──────────────────────────────────────────────────────────
// // Tracks which tasks a user has completed each day
// const progressSchema = new mongoose.Schema({
//   userId:      { type: String, required: true },
//   day:         { type: Number, required: true },
//   topic:       { type: String, required: true },
//   completed:   { type: Boolean, default: false },
//   completedAt: { type: Date },
// });

// export const Progress = mongoose.model("Progress", progressSchema);