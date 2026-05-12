// import express from "express";
// import cors from "cors";
// import dotenv from "dotenv";
// import OpenAI from "openai";
// import Groq from "groq-sdk";
// import mongoose from "mongoose";
// import { User, Plan, Progress } from "./models.js";

// dotenv.config();

// // ─── App setup ───────────────────────────────────────────────────────────────
// const app = express();
// app.use(cors());
// app.use(express.json());

// const PORT = process.env.PORT || 3000;

// // ─── MongoDB connection ───────────────────────────────────────────────────────
// // We'll connect to MongoDB later (Phase 3). For now this is a placeholder.
// const connectDB = async () => {
//     if (!process.env.MONGO_URI) {
//         console.log("[DB] No MONGO_URI in .env — skipping DB connection for now.");
//         return;
//     }
//     try {
//         await mongoose.connect(process.env.MONGO_URI);
//         console.log("[DB] MongoDB connected.");
//     } catch (err) {
//         console.error("[DB] Connection failed:", err.message);
//     }
// };

// // ─── Gemini client ────────────────────────────────────────────────────────────
// // const genAI = new OpenAI({
// //   baseURL: "https://openrouter.ai/api/v1",
// //   apiKey: process.env.OPENROUTER_API_KEY,
// // });
// const genAI = new Groq({ apiKey: process.env.GROQ_API_KEY });

// // ─── Routes ───────────────────────────────────────────────────────────────────

// // GET /health  →  quick check that server is alive
// app.get("/health", (req, res) => {
//     res.json({ status: "ok", message: "PrepPilot server is running." });
// });

// // POST /agent  →  main agent endpoint (Gemini + tool calling)
// // Body: { goal: "Prepare me in 30 days" }
// app.post("/agent", async (req, res) => {
//     const { goal } = req.body;

//     if (!goal) {
//         return res.status(400).json({ error: "goal is required in request body." });
//     }

//     try {
//         const agentLog = [];

//         // ── Tool handlers ─────────────────────────────────────────────────────
//         const toolHandlers = {
//             fetch_user_history: async ({ userId }) => {
//                 console.log(`[Tool] fetch_user_history → ${userId}`);
//                 let user = await User.findOne({ userId });

//                 // If user doesn't exist yet, create them with default data
//                 if (!user) {
//                     user = await User.create({
//                         userId,
//                         solvedProblems: 0,
//                         topics: [
//                             { name: "Arrays", attempted: 0, correct: 0 },
//                             { name: "Dynamic Programming", attempted: 0, correct: 0 },
//                             { name: "Graphs", attempted: 0, correct: 0 },
//                             { name: "Trees", attempted: 0, correct: 0 },
//                             { name: "Sliding Window", attempted: 0, correct: 0 },
//                         ],
//                     });
//                     console.log(`[DB] New user created: ${userId}`);
//                 }
//                 return user;
//             },

//             analyze_weak_topics: ({ history }) => {
//                 console.log("[Tool] analyze_weak_topics");
//                 const topics = typeof history === "string" ? JSON.parse(history).topics : history.topics;
//                 return topics
//                     .map((t) => ({
//                         topic: t.name,
//                         accuracy: Math.round((t.correct / t.attempted) * 100),
//                     }))
//                     .filter((t) => t.accuracy < 70)
//                     .sort((a, b) => a.accuracy - b.accuracy);
//             },

//             generate_plan: ({ goal, weakTopics }) => {
//                 console.log("[Tool] generate_plan");
//                 const topics = typeof weakTopics === "string" ? JSON.parse(weakTopics) : weakTopics;
//                 return {
//                     goal,
//                     totalDays: 30,
//                     plan: topics.map((t, i) => ({
//                         day: i + 1,
//                         focus: t.topic,
//                         accuracy: t.accuracy,
//                         tasks: [
//                             `Revise ${t.topic} concepts (30 min)`,
//                             `Solve 3 easy ${t.topic} problems on LeetCode`,
//                             `Solve 1 medium ${t.topic} problem`,
//                         ],
//                     })),
//                 };
//             },

//             save_plan: async ({ userId, plan }) => {
//                 console.log(`[Tool] save_plan → ${userId}`);
//                 const parsedPlan = typeof plan === "string" ? JSON.parse(plan) : plan;

//                 // Delete old plan if exists, then save new one
//                 await Plan.deleteOne({ userId });
//                 const saved = await Plan.create({
//                     userId,
//                     goal: parsedPlan.goal,
//                     totalDays: parsedPlan.totalDays,
//                     plan: parsedPlan.plan,
//                 });
//                 console.log(`[DB] Plan saved for ${userId}`);
//                 return { success: true, planId: saved._id, savedAt: saved.createdAt };
//             },
//         };

//         // ── Step 1: Fetch history ─────────────────────────────────────────────
//         agentLog.push({ step: 1, tool: "fetch_user_history", status: "calling" });
//         const history = await toolHandlers.fetch_user_history({ userId: "user_001" });
//         agentLog.push({ step: 1, tool: "fetch_user_history", status: "done", result: history });

//         // ── Step 2: Analyze weak topics ───────────────────────────────────────
//         agentLog.push({ step: 2, tool: "analyze_weak_topics", status: "calling" });
//         const weakTopics = toolHandlers.analyze_weak_topics({ history });
//         agentLog.push({ step: 2, tool: "analyze_weak_topics", status: "done", result: weakTopics });

//         // ── Step 3: Generate plan ─────────────────────────────────────────────
//         agentLog.push({ step: 3, tool: "generate_plan", status: "calling" });
//         const plan = toolHandlers.generate_plan({ goal, weakTopics });
//         agentLog.push({ step: 3, tool: "generate_plan", status: "done", result: plan });

//         // ── Step 4: Save plan ─────────────────────────────────────────────────
//         agentLog.push({ step: 4, tool: "save_plan", status: "calling" });
//         const saved = await toolHandlers.save_plan({ userId: "user_001", plan: JSON.stringify(plan) });
//         agentLog.push({ step: 4, tool: "save_plan", status: "done", result: saved });

//         // ── Step 5: Ask Groq to summarize the result ──────────────────────────
//         agentLog.push({ step: 5, tool: "gemini_summary", status: "calling" });
//         const completion = await genAI.chat.completions.create({
//             model: "llama-3.3-70b-versatile",
//             messages: [
//                 {
//                     role: "system",
//                     content: "You are PrepPilot, a coding interview preparation coach. Summarize the preparation plan clearly and encouragingly for the user.",
//                 },
//                 {
//                     role: "user",
//                     content: `The user's goal: "${goal}"\n\nWeak topics found: ${JSON.stringify(weakTopics)}\n\nGenerated plan: ${JSON.stringify(plan)}\n\nSummarize this plan clearly for the user in 150 words or less.`,
//                 },
//             ],
//             max_tokens: 300,
//         });

//         const summary = completion.choices[0].message.content;
//         agentLog.push({ step: 5, tool: "summary", status: "done" });

//         res.json({ success: true, goal, agentLog, weakTopics, plan, response: summary });

//     } catch (err) {
//         console.error("[Agent] Error:", err.message);
//         res.status(500).json({ error: err.message });
//     }
// });

// // ─── Start server ─────────────────────────────────────────────────────────────
// connectDB().then(() => {
//     app.listen(PORT, () => {
//         console.log(`\n✅ PrepPilot server running on http://localhost:${PORT}`);
//         console.log(`   Health check → GET  http://localhost:${PORT}/health`);
//         console.log(`   Agent        → POST http://localhost:${PORT}/agent`);
//         console.log(`   Body: { "goal": "Prepare me in 30 days" }\n`);
//     });
// });