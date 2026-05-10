import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Groq from "groq-sdk";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── MongoDB connection ───────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI).then(() => {
    console.log("[DB] MongoDB connected.");
}).catch((err) => console.error("[DB] Error:", err.message));

// ─── Schemas ──────────────────────────────────────────────────────────────────

// User settings — your handle, friends, practice rating
const userSettingsSchema = new mongoose.Schema({
    myHandle: { type: String, required: true, unique: true },
    friendHandles: [String],
    practiceRating: { type: Number, default: 1200 },
    currentRating: { type: Number, default: 1200 },
    updatedAt: { type: Date, default: Date.now },
});
const UserSettings = mongoose.model("UserSettings", userSettingsSchema);

// Backlog — problems friends solved/attempted that you haven't solved
const backlogSchema = new mongoose.Schema({
    myHandle: String,
    contestId: Number,
    index: String,
    name: String,
    rating: Number,
    tags: [String],
    solvedBy: [String],  // friends who solved it
    attemptedBy: [String],  // friends who attempted but didn't solve
    friendSolveCount: { type: Number, default: 0 },
    nearMyRating: { type: Boolean, default: false },
    url: String,
    updatedAt: { type: Date, default: Date.now },
});
const Backlog = mongoose.model("Backlog", backlogSchema);

// Priority queue — problems Groq recommended after analyzing weak topics
const priorityQueueSchema = new mongoose.Schema({
    myHandle: String,
    contestId: Number,
    index: String,
    name: String,
    rating: Number,
    tags: [String],
    topic: String,   // which weak topic this addresses
    priority: Number,   // 1 = highest
    url: String,
    done: { type: Boolean, default: false },
    fromBacklog: { type: Boolean, default: false },
    addedAt: { type: Date, default: Date.now },
});
const PriorityQueue = mongoose.model("PriorityQueue", priorityQueueSchema);

// Plan — daily todos for Y days
const todoSchema = new mongoose.Schema({
    contestId: Number,
    index: String,
    name: String,
    rating: Number,
    url: String,
    topic: String,
    done: { type: Boolean, default: false },
});
const planSchema = new mongoose.Schema({
    myHandle: String,
    day: Number,
    date: Date,
    todos: [todoSchema],
    createdAt: { type: Date, default: Date.now },
});
const Plan = mongoose.model("CFPlan", planSchema);

// ─── Helper: fetch from Codeforces API ───────────────────────────────────────
const cfFetch = async (url) => {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== "OK") throw new Error(`CF API error: ${data.comment}`);
    return data.result;
};

// ─── Helper: get all accepted problem keys for a handle ───────────────────────
const getSolvedKeys = async (handle) => {
    const submissions = await cfFetch(
        `https://codeforces.com/api/user.status?handle=${handle}&count=10000`
    );
    const solved = new Set();
    const attempted = new Set();
    for (const sub of submissions) {
        if (!sub.problem.contestId) continue;
        const key = `${sub.problem.contestId}-${sub.problem.index}`;
        if (sub.verdict === "OK") solved.add(key);
        else attempted.add(key);
    }
    return { solved, attempted };
};

// ─── ROUTE 1: POST /api/setup ─────────────────────────────────────────────────
// Save your CF handle, friends, and practice rating
app.post("/api/setup", async (req, res) => {
    const { myHandle, friendHandles, practiceRating } = req.body;

    if (!myHandle) return res.status(400).json({ error: "myHandle is required." });
    if (!Array.isArray(friendHandles)) {
        return res.status(400).json({ error: "friendHandles must be an array." });
    }

    try {
        // Validate all handles exist on CF
        let currentRating;
        console.log(`[Setup] Validating handles...`);
        for (const handle of [myHandle, ...friendHandles]) {
            try {
                const result = await cfFetch(`https://codeforces.com/api/user.info?handles=${handle}`);
                if (handle === myHandle && result[0].rating) {
                    currentRating = result[0].rating;
                    console.log(`[Setup] ${myHandle} current rating: ${currentRating}`);
                }
            } catch {
                return res.status(400).json({ error: `CF handle not found: ${handle}` });
            }
        }


        // Save or update settings
        await UserSettings.findOneAndUpdate(
            { myHandle },
            {
                myHandle,
                friendHandles,
                practiceRating: practiceRating || currentRating,
                currentRating,
                updatedAt: new Date(),
            },
            { upsert: true, new: true }
        );

        console.log(`[Setup] Saved settings for ${myHandle}`);
        res.json({ success: true, message: `Setup complete for ${myHandle}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── ROUTE 2: GET /api/backlog?handle=YOUR_HANDLE ─────────────────────────────
// Fetch all problems friends solved/attempted that you haven't solved
app.get("/api/backlog", async (req, res) => {
    const { handle } = req.query;
    if (!handle) return res.status(400).json({ error: "handle query param required." });

    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.status(404).json({ error: "Run /api/setup first." });

        const { friendHandles, practiceRating } = settings;
        const RATING_RANGE = 200;

        console.log(`[Backlog] Fetching submissions for ${handle} and ${friendHandles.length} friends...`);

        // Get your solved problems
        const { solved: mySolved } = await getSolvedKeys(handle);
        console.log(`[Backlog] You solved ${mySolved.size} problems.`);

        // Get each friend's solved + attempted problems
        const problemMap = {}; // key → { problem, solvedBy[], attemptedBy[] }

        for (const friend of friendHandles) {
            console.log(`[Backlog] Fetching ${friend}'s submissions...`);
            const { solved: friendSolved, attempted: friendAttempted } = await getSolvedKeys(friend);

            // Add solved problems
            for (const key of friendSolved) {
                if (!mySolved.has(key)) {
                    if (!problemMap[key]) problemMap[key] = { solvedBy: [], attemptedBy: [] };
                    if (!problemMap[key].solvedBy.includes(friend)) {
                        problemMap[key].solvedBy.push(friend);
                    }
                }
            }

            // Add attempted-but-not-solved problems
            for (const key of friendAttempted) {
                if (!mySolved.has(key) && !friendSolved.has(key)) {
                    if (!problemMap[key]) problemMap[key] = { solvedBy: [], attemptedBy: [] };
                    if (!problemMap[key].attemptedBy.includes(friend)) {
                        problemMap[key].attemptedBy.push(friend);
                    }
                }
            }
        }

        console.log(`[Backlog] Found ${Object.keys(problemMap).length} unique unsolved problems.`);

        // Fetch problem details from CF problemset
        const allProblems = await cfFetch("https://codeforces.com/api/problemset.problems");
        const problemDetails = {}; // "contestId-index" → problem object
        for (const p of allProblems.problems) {
            if (p.contestId && p.index) {
                problemDetails[`${p.contestId}-${p.index}`] = p;
            }
        }

        // Build backlog array
        const backlog = [];
        for (const [key, data] of Object.entries(problemMap)) {
            const detail = problemDetails[key];
            if (!detail) continue; // skip if problem details not found

            const [contestId, index] = key.split("-");
            const rating = detail.rating || null;
            const nearMyRating = rating
                ? Math.abs(rating - practiceRating) <= RATING_RANGE
                : false;

            backlog.push({
                key,
                contestId: Number(contestId),
                index,
                name: detail.name,
                rating,
                tags: detail.tags || [],
                solvedBy: data.solvedBy,
                attemptedBy: data.attemptedBy,
                friendSolveCount: data.solvedBy.length,
                nearMyRating,
                url: `https://codeforces.com/problemset/problem/${contestId}/${index}`,
            });
        }

        // Sort: nearMyRating first, then by friendSolveCount descending
        backlog.sort((a, b) => {
            if (a.nearMyRating && !b.nearMyRating) return -1;
            if (!a.nearMyRating && b.nearMyRating) return 1;
            return b.friendSolveCount - a.friendSolveCount;
        });

        // Save to MongoDB (upsert each problem)
        console.log(`[Backlog] Saving ${backlog.length} problems to MongoDB...`);
        for (const p of backlog) {
            await Backlog.findOneAndUpdate(
                { myHandle: handle, contestId: p.contestId, index: p.index },
                { ...p, myHandle: handle, updatedAt: new Date() },
                { upsert: true, new: true }
            );
        }

        res.json({
            success: true,
            total: backlog.length,
            nearMyRating: backlog.filter((p) => p.nearMyRating).length,
            practiceRating,
            backlog,
        });
    } catch (err) {
        console.error("[Backlog] Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── ROUTE 3: POST /api/analyze ───────────────────────────────────────────────
// Fetch last X days of your submissions, analyze weak topics with Groq,
// save recommended problems to priority queue
app.post("/api/analyze", async (req, res) => {
    const { handle, days } = req.body;
    if (!handle || !days) {
        return res.status(400).json({ error: "handle and days are required." });
    }

    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.status(404).json({ error: "Run /api/setup first." });

        const { practiceRating } = settings;
        const cutoff = Date.now() / 1000 - days * 86400; // unix timestamp X days ago
        const RATING_RANGE = 300;
        const PROBLEMS_PER_TOPIC = 12;

        console.log(`[Analyze] Fetching last ${days} days of submissions for ${handle}...`);
        const allSubmissions = await cfFetch(
            `https://codeforces.com/api/user.status?handle=${handle}&count=10000`
        );

        // Filter to last X days
        const recent = allSubmissions.filter((s) => s.creationTimeSeconds >= cutoff);
        console.log(`[Analyze] Found ${recent.length} submissions in last ${days} days.`);

        if (recent.length === 0) {
            return res.status(400).json({ error: `No submissions found in last ${days} days.` });
        }

        // Build summary for Groq
        const topicStats = {};
        // const ratingStats = {};
        const questions = {};

        for (const sub of recent) {
            // const verdict = sub.verdict === "OK" ? "solved" : "attempted";
            const tags = sub.problem.tags || [];
            const rating = sub.problem.rating;
            const key = `${sub.problem.contestId}-${sub.problem.index}`;

            if (!questions[key]) {
                questions[key] = {
                    contestId: sub.problem.contestId,
                    index: sub.problem.index,
                    name: sub.problem.name,
                    tags, rating,
                    attempts: 0,
                    solved: false,
                    url: `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`,
                };
            }
            questions[key].attempts++;
            if (sub.verdict === "OK") questions[key].solved = true;

            for (const tag of tags) {
                if (!topicStats[tag]) topicStats[tag] = { attempted: 0, solved: 0 };
                topicStats[tag].attempted++;
                if (sub.verdict === "OK") topicStats[tag].solved++;
            }
        }


        const allQuestions = Object.values(questions);
        const solvedKeys = new Set(
            allQuestions.filter((q) => q.solved).map((q) => `${q.contestId}-${q.index}`)
        );

        // Filter topics with enough data
        // const topicSummary = Object.entries(topicStats)
        //     .filter(([, s]) => s.attempted >= MIN_ATTEMPTS)
        //     .map(([topic, s]) => ({
        //         topic,
        //         attempted: s.attempted,
        //         solved: s.solved,
        //         accuracy: Math.round((s.solved / s.attempted) * 100),
        //     }))
        //     .sort((a, b) => a.accuracy - b.accuracy);

        const unsolvedQuestions = allQuestions
            .filter((q) => !q.solved)
            .sort((a, b) => b.attempts - a.attempts);

        console.log(`[Analyze] Sending ${unsolvedQuestions.length} unsolved problems to Groq...`);

        console.log(`[Analyze] Sending data to Groq...`);

        const groqPrompt = `You are a competitive programming coach.

User's practice rating: ${practiceRating}
User's current CF rating: ${settings.currentRating}
Analysis period: last ${days} days
Total submissions: ${recent.length}

Problems user struggled with most (unsolved, sorted by attempt count):
${JSON.stringify(unsolvedQuestions.slice(0, 15), null, 2)}

Problems user solved:
${JSON.stringify(allQuestions.filter(q => q.solved).slice(0, 15), null, 2)}

Identify the top 5 weakest topics. Only include a topic if it has been attempted more enough of times than but with low accuracy.

Respond ONLY with valid JSON, no other text, no markdown:
{
  "weakTopics": [
    {
      "topic": "binary search",
      "accuracy": 35,
      "attempted": 17,
      "solved": 6,
      "reason": "17 attempts only 6 solved"
    }
  ],
  "summary": "2 sentence analysis"
}`;

        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: groqPrompt }],
            max_tokens: 600,
            temperature: 0.2,
        });

        let analysis;
        try {
            const raw = completion.choices[0].message.content;
            console.log("[Groq RAW]", raw);
            const clean = raw.replace(/```json|```/g, "").trim();
            analysis = JSON.parse(clean);
        } catch (parseErr) {
            console.log("[Groq PARSE ERROR]", parseErr.message);
            return res.status(500).json({ error: "Groq returned invalid JSON. Try again." });
        }

        const weakTopicNames = analysis.weakTopics.map((t) => t.topic);
        console.log(`[Analyze] Weak topics: ${weakTopicNames.join(", ")}`);

        // ── Fetch REAL problems from CF problemset ──────────────────────────
        console.log(`[Analyze] Fetching real problems from CF...`);
        const cfProblems = await cfFetch("https://codeforces.com/api/problemset.problems");

        await PriorityQueue.deleteMany({ myHandle: handle, fromBacklog: { $ne: true } });

        const allCandidates = [];
        const seen = new Set();

        for (const weakTopic of analysis.weakTopics) {
            const tag = weakTopic.topic;

            // Find real CF problems in rating range, not already solved, matching this tag
            const matching = cfProblems.problems.filter((p) => {
                const key = `${p.contestId}-${p.index}`;
                return (
                    p.rating &&
                    p.rating >= practiceRating - 100 &&
                    p.rating <= practiceRating + 300 &&
                    p.tags && p.tags.includes(tag) &&
                    !solvedKeys.has(key) &&
                    p.contestId
                );
            });

            // Shuffle to get variety, take top 12
            const picked = matching
                .sort(() => Math.random() - 0.5)
                .slice(0, 12);

            for (const p of picked) {
                const key = `${p.contestId}-${p.index}`;
                if (seen.has(key)) {
                    // Problem covers multiple weak topics — boost its score
                    const existing = allCandidates.find((c) => c.key === key);
                    if (existing) existing.score += 10;
                    continue;
                }
                seen.add(key);

                const weakTopicsCovered = p.tags.filter((t) => weakTopicNames.includes(t));
                const ratingBonus = Math.max(0, 10 - Math.floor(Math.abs(p.rating - practiceRating) / 50));
                const score = (weakTopicsCovered.length * 10) + ratingBonus;

                allCandidates.push({
                    key,
                    contestId: p.contestId,
                    index: p.index,
                    name: p.name,
                    rating: p.rating,
                    tags: p.tags,
                    primaryTopic: tag,
                    score,
                });
            }
        }

        // Sort by score — multi-topic problems first
        allCandidates.sort((a, b) => b.score - a.score);

        // Save to priority queue
        for (let i = 0; i < allCandidates.length; i++) {
            const p = allCandidates[i];
            await PriorityQueue.create({
                myHandle: handle,
                contestId: p.contestId,
                index: p.index,
                name: p.name,
                rating: p.rating,
                tags: p.tags,
                topic: p.primaryTopic,
                priority: i + 1,
                url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,
                done: false,
            });
        }

        const savedCount = await PriorityQueue.countDocuments({ myHandle: handle });
        console.log(`[Analyze] Saved ${savedCount} real CF problems to priority queue.`);

        res.json({
            success: true,
            submissionsAnalyzed: recent.length,
            weakTopics: analysis.weakTopics,
            summary: analysis.summary,
            priorityQueueSize: savedCount,
            topProblems: allCandidates.slice(0, 10),
        });

    } catch (err) {
        console.error("[Analyze] Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── ROUTE 4: POST /api/plan ──────────────────────────────────────────────────
// Generate a Y-day plan from the priority queue
app.post("/api/plan", async (req, res) => {
    const { handle, days } = req.body;
    if (!handle || !days) {
        return res.status(400).json({ error: "handle and days are required." });
    }

    try {
        const queue = await PriorityQueue.find({ myHandle: handle, done: false })
            .sort({ priority: 1 });

        if (queue.length === 0) {
            return res.status(400).json({ error: "Priority queue empty. Run /api/analyze first." });
        }

        const PROBLEMS_PER_DAY = Math.ceil(queue.length / days);
        console.log(`[Plan] ${queue.length} problems → ${days} days → ~${PROBLEMS_PER_DAY}/day`);

        // ── Interleave topics so each day has variety ─────────────────────
        // Group problems by topic
        const byTopic = {};
        for (const p of queue) {
            if (!byTopic[p.topic]) byTopic[p.topic] = [];
            byTopic[p.topic].push(p);
        }

        // Round-robin across topics — pick one from each topic in rotation
        // This ensures Day 1 has binary search + dp + greedy, not just binary search
        const topicQueues = Object.values(byTopic);
        const interleaved = [];
        let i = 0;
        while (interleaved.length < queue.length) {
            const tq = topicQueues[i % topicQueues.length];
            if (tq && tq.length > 0) interleaved.push(tq.shift());
            i++;
            if (topicQueues.every((tq) => tq.length === 0)) break;
        }

        // ── Chunk into days ───────────────────────────────────────────────
        await Plan.deleteMany({ myHandle: handle });
        const today = new Date();
        const planResult = [];

        for (let day = 1; day <= days; day++) {
            const start = (day - 1) * PROBLEMS_PER_DAY;
            const dayProblems = interleaved.slice(start, start + PROBLEMS_PER_DAY);
            if (dayProblems.length === 0) break;

            const topics = [...new Set(dayProblems.map((p) => p.topic))];
            const date = new Date(today);
            date.setDate(today.getDate() + day - 1);

            await Plan.create({
                myHandle: handle,
                day,
                date,
                todos: dayProblems.map((p) => ({
                    contestId: p.contestId,
                    index: p.index,
                    name: p.name,
                    rating: p.rating,
                    url: p.url,
                    topic: p.topic,
                    done: false,
                })),
            });

            planResult.push({
                day,
                date,
                focus: topics.join(" + "),
                problemCount: dayProblems.length,
                problems: dayProblems.map((p) => ({
                    contestId: p.contestId,
                    index: p.index,
                    name: p.name,
                    rating: p.rating,
                    topic: p.topic,
                    url: p.url,
                })),
            });
        }

        console.log(`[Plan] Saved ${planResult.length}-day plan to MongoDB.`);

        res.json({
            success: true,
            totalDays: planResult.length,
            problemsPerDay: PROBLEMS_PER_DAY,
            totalProblems: interleaved.length,
            plan: planResult,
        });

    } catch (err) {
        console.error("[Plan] Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// ─── ROUTE 5a: GET /api/today?handle=X&day=N ─────────────────────────────────
// Get todos for a specific day (default: day 1)
app.get("/api/today", async (req, res) => {
    const { handle, day } = req.query;
    if (!handle) return res.status(400).json({ error: "handle required." });

    try {
        const dayNum = parseInt(day) || 1;
        const dayPlan = await Plan.findOne({ myHandle: handle, day: dayNum });

        if (!dayPlan) {
            return res.status(404).json({ error: `No plan found for day ${dayNum}. Run /api/plan first.` });
        }

        const done = dayPlan.todos.filter((t) => t.done).length;
        const total = dayPlan.todos.length;

        res.json({
            success: true,
            day: dayNum,
            date: dayPlan.date,
            progress: `${done}/${total}`,
            todos: dayPlan.todos,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── ROUTE 5b: POST /api/complete ─────────────────────────────────────────────
// Mark a todo as done
app.post("/api/complete", async (req, res) => {
    const { handle, day, contestId, index } = req.body;
    if (!handle || !day || !contestId || !index) {
        return res.status(400).json({ error: "handle, day, contestId, index required." });
    }

    try {
        const dayPlan = await Plan.findOne({ myHandle: handle, day });
        if (!dayPlan) return res.status(404).json({ error: "Day plan not found." });

        const todo = dayPlan.todos.find(
            (t) => t.contestId === contestId && t.index === index
        );
        if (!todo) return res.status(404).json({ error: "Todo not found." });

        todo.done = true;
        await dayPlan.save();

        // Also mark done in priority queue
        await PriorityQueue.findOneAndUpdate(
            { myHandle: handle, contestId, index },
            { done: true }
        );

        const done = dayPlan.todos.filter((t) => t.done).length;
        const total = dayPlan.todos.length;

        res.json({
            success: true,
            message: `Marked ${contestId}${index} as done.`,
            progress: `${done}/${total}`,
            dayComplete: done === total,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── ROUTE: POST /api/verify ──────────────────────────────────────────────────
// Check if user actually solved a problem on CF
app.post("/api/verify", async (req, res) => {
    const { handle, contestId, index } = req.body;
    if (!handle || !contestId || !index) {
        return res.status(400).json({ error: "handle, contestId, index required." });
    }
    try {
        const submissions = await cfFetch(
            `https://codeforces.com/api/user.status?handle=${handle}&count=500`
        );
        const solved = submissions.some(
            (s) =>
                s.problem.contestId === Number(contestId) &&
                s.problem.index === index &&
                s.verdict === "OK"
        );
        res.json({ solved });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ─── ROUTE: POST /api/queue/add ───────────────────────────────────────────────
// Add a backlog problem to priority queue (persists through reanalyze)
app.post("/api/queue/add", async (req, res) => {
    const { handle, contestId, index, name, rating, tags, topic, url } = req.body;
    if (!handle || !contestId || !index) {
        return res.status(400).json({ error: "handle, contestId, index required." });
    }
    try {
        // Check if already in queue
        const existing = await PriorityQueue.findOne({ myHandle: handle, contestId, index });
        if (existing) {
            return res.json({ success: true, message: "Already in queue.", alreadyExists: true });
        }
        // Get current lowest priority number and add below it
        const last = await PriorityQueue.findOne({ myHandle: handle }).sort({ priority: -1 });
        const nextPriority = last ? last.priority + 1 : 1;
        await PriorityQueue.create({
            myHandle: handle,
            contestId: Number(contestId),
            index, name, rating,
            tags: tags || [],
            topic: topic || "backlog",
            priority: nextPriority,
            url: url || `https://codeforces.com/problemset/problem/${contestId}/${index}`,
            done: false,
            fromBacklog: true, // flag so we never delete these on reanalyze
        });
        res.json({ success: true, message: "Added to priority queue." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ─── ROUTE: GET /api/profile?handle=X ────────────────────────────────────────
app.get("/api/profile", async (req, res) => {
    const { handle } = req.query;
    if (!handle) return res.status(400).json({ error: "handle required." });
    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.status(404).json({ error: "Not found." });
        const queue = await PriorityQueue.find({ myHandle: handle }).sort({ priority: 1 });
        const plans = await Plan.find({ myHandle: handle }).sort({ day: 1 });
        const totalSolved = await PriorityQueue.countDocuments({ myHandle: handle, done: true });
        res.json({ success: true, settings, queueSize: queue.length, plans, totalSolved });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── ROUTE: POST /api/progress/save ──────────────────────────────────────────
// Save todo states (solved/wrong) to DB so they persist
const progressStateSchema = new mongoose.Schema({
    myHandle: String,
    key: String, // "day-contestId-index"
    state: String, // "solved" | "wrong"
    updatedAt: { type: Date, default: Date.now },
});
const ProgressState = mongoose.model("ProgressState", progressStateSchema);

app.post("/api/progress/save", async (req, res) => {
    const { handle, key, state } = req.body;
    if (!handle || !key || !state) return res.status(400).json({ error: "handle, key, state required." });
    try {
        await ProgressState.findOneAndUpdate(
            { myHandle: handle, key },
            { myHandle: handle, key, state, updatedAt: new Date() },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/progress/load", async (req, res) => {
    const { handle } = req.query;
    if (!handle) return res.status(400).json({ error: "handle required." });
    try {
        const states = await ProgressState.find({ myHandle: handle });
        const map = {};
        for (const s of states) map[s.key] = s.state;
        res.json({ success: true, states: map });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// ─── ROUTE: POST /api/uncomplete ─────────────────────────────────────────────
app.post("/api/uncomplete", async (req, res) => {
    const { handle, day, contestId, index } = req.body;
    if (!handle || !day || !contestId || !index) {
        return res.status(400).json({ error: "handle, day, contestId, index required." });
    }
    try {
        const dayPlan = await Plan.findOne({ myHandle: handle, day });
        if (!dayPlan) return res.status(404).json({ error: "Day plan not found." });
        const todo = dayPlan.todos.find(t => t.contestId === contestId && t.index === index);
        if (todo) { todo.done = false; await dayPlan.save(); }
        await PriorityQueue.findOneAndUpdate({ myHandle: handle, contestId, index }, { done: false });
        await ProgressState.findOneAndDelete({ myHandle: handle, key: `${day}-${contestId}-${index}` });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n✅ CF Tracker server running on http://localhost:${PORT}`);
    console.log(`   Setup    → POST http://localhost:${PORT}/api/setup`);
    console.log(`   Backlog  → GET  http://localhost:${PORT}/api/backlog?handle=YOUR_HANDLE`);
    console.log(`   Analyze  → POST http://localhost:${PORT}/api/analyze`);
    console.log(`   Plan     → POST http://localhost:${PORT}/api/plan`);
    console.log(`   Today    → GET  http://localhost:${PORT}/api/today?handle=YOUR_HANDLE&day=1`);
    console.log(`   Complete → POST http://localhost:${PORT}/api/complete\n`);
});