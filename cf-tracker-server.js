import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Groq from "groq-sdk";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
app.use(cors({
    origin: process.env.FRONTEND_URL, // e.g. "https://yourapp.vercel.app"
    // origin: "http://localhost:5173", // e.g. "https://yourapp.vercel.app"
    credentials: true,
    exposedHeaders: ["Content-Type", "Cache-Control"],
}));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "cf_tracker_secret_change_in_prod";
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── MongoDB ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("[DB] MongoDB connected."))
    .catch((err) => console.error("[DB] Error:", err.message));

// ─── Schemas ──────────────────────────────────────────────────────────────────
const userSettingsSchema = new mongoose.Schema({
    myHandle: { type: String, required: true, unique: true },
    friendHandles: [String],
    practiceRating: { type: Number, default: 1200 },
    currentRating: { type: Number, default: 1200 },
    ratingRange: { type: Number, default: 200 },
    passwordHash: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
});
const UserSettings = mongoose.model("UserSettings", userSettingsSchema);

const backlogSchema = new mongoose.Schema({
    myHandle: String, contestId: Number, index: String, name: String,
    rating: Number, tags: [String], solvedBy: [String], attemptedBy: [String],
    friendSolveCount: { type: Number, default: 0 },
    nearMyRating: { type: Boolean, default: false },
    url: String, updatedAt: { type: Date, default: Date.now },
});
const Backlog = mongoose.model("Backlog", backlogSchema);
Backlog.collection.createIndex({ myHandle: 1, nearMyRating: -1, friendSolveCount: -1 });

const friendProblemsSchema = new mongoose.Schema({
    handle: { type: String, required: true, unique: true },
    solved: [{ contestId: Number, index: String, name: String, rating: Number, tags: [String], url: String }],
    attempted: [{ contestId: Number, index: String, name: String, rating: Number, tags: [String], url: String }],
    lastSubmissionTime: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },
});
const FriendProblems = mongoose.model("FriendProblems", friendProblemsSchema);

const userSolvedCacheSchema = new mongoose.Schema({
    myHandle: { type: String, required: true, unique: true },
    solvedKeys: [String],
    lastSubmissionTime: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },
});
const UserSolvedCache = mongoose.model("UserSolvedCache", userSolvedCacheSchema);

const priorityQueueSchema = new mongoose.Schema({
    myHandle: String, contestId: Number, index: String, name: String,
    rating: Number, tags: [String], topic: String, priority: Number,
    url: String, done: { type: Boolean, default: false },
    fromBacklog: { type: Boolean, default: false },
    addedAt: { type: Date, default: Date.now },
    score: { type: Number, default: 0 },
    friendSolveCount: { type: Number, default: 0 },
});
const PriorityQueue = mongoose.model("PriorityQueue", priorityQueueSchema);

const todoSchema = new mongoose.Schema({
    contestId: Number, index: String, name: String, rating: Number,
    url: String, topic: String, done: { type: Boolean, default: false },
    score: { type: Number, default: 0 },
    friendSolveCount: { type: Number, default: 0 },
});
const planSchema = new mongoose.Schema({
    myHandle: String, day: Number, date: Date, todos: [todoSchema],
    createdAt: { type: Date, default: Date.now },
});
const Plan = mongoose.model("CFPlan", planSchema);

const progressStateSchema = new mongoose.Schema({
    myHandle: String, key: String, state: String,
    problem: todoSchema, day: Number,
    updatedAt: { type: Date, default: Date.now },
});
const ProgressState = mongoose.model("ProgressState", progressStateSchema);

// ─── JWT helpers ──────────────────────────────────────────────────────────────
const signToken = (handle) =>
    jwt.sign({ handle }, JWT_SECRET, { expiresIn: "30d" });

const verifyToken = (token) => {
    try { return jwt.verify(token, JWT_SECRET); }
    catch { return null; }
};

// ─── Auth middleware (JWT) ────────────────────────────────────────────────────
const requireAuth = async (req, res, next) => {
    const auth = req.headers["authorization"];
    if (!auth || !auth.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided.", needsLogin: true });
    }
    const token = auth.slice(7);
    const decoded = verifyToken(token);
    if (!decoded) {
        return res.status(401).json({ error: "Invalid or expired token.", needsLogin: true });
    }
    req.userHandle = decoded.handle;
    next();
};

// ─── CF API helper ────────────────────────────────────────────────────────────
const cfFetch = async (url) => {
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== "OK") throw new Error(`CF API error: ${data.comment}`);
    return data.result;
};

// ─── Rebuild backlog helper ───────────────────────────────────────────────────
const rebuildBacklog = async (myHandle) => {
    const settings = await UserSettings.findOne({ myHandle });
    if (!settings) throw new Error("User not found.");
    const { friendHandles, practiceRating, ratingRange } = settings;
    const RATING_RANGE = ratingRange ?? 200;

    const myCache = await UserSolvedCache.findOne({ myHandle });
    const mySolvedKeys = new Set(myCache?.solvedKeys || []);

    // ── build problemMap (unchanged) ─────────────────────────────────────────
    const problemMap = {};
    const friendCaches = await FriendProblems.find({ handle: { $in: friendHandles } });
    const friendCacheMap = Object.fromEntries(friendCaches.map(f => [f.handle, f]));

    for (const friend of friendHandles) {
        const cached = friendCacheMap[friend];
        if (!cached) continue;
        if (!cached) continue;
        for (const p of cached.solved) {
            const key = `${p.contestId}-${p.index}`;
            if (mySolvedKeys.has(key)) continue;
            if (!problemMap[key]) problemMap[key] = { problem: p, solvedBy: [], attemptedBy: [] };
            if (!problemMap[key].solvedBy.includes(friend)) problemMap[key].solvedBy.push(friend);
        }
        for (const p of cached.attempted) {
            const key = `${p.contestId}-${p.index}`;
            if (mySolvedKeys.has(key)) continue;
            if (!problemMap[key]) problemMap[key] = { problem: p, solvedBy: [], attemptedBy: [] };
            if (!problemMap[key].solvedBy.includes(friend) && !problemMap[key].attemptedBy.includes(friend))
                problemMap[key].attemptedBy.push(friend);
        }
    }

    // ── build all docs in memory first ───────────────────────────────────────
    const backlog = [];
    const bulkOps = [];

    for (const [key, data] of Object.entries(problemMap)) {
        const p = data.problem;
        const nearMyRating = p.rating
            ? Math.abs(p.rating - practiceRating) <= RATING_RANGE
            : false;
        const doc = {
            key, contestId: p.contestId, index: p.index, name: p.name,
            rating: p.rating, tags: p.tags, solvedBy: data.solvedBy,
            attemptedBy: data.attemptedBy, friendSolveCount: data.solvedBy.length,
            nearMyRating, url: p.url, myHandle, updatedAt: new Date(),
        };
        backlog.push(doc);

        // queue as bulk op instead of awaiting individually
        bulkOps.push({
            updateOne: {
                filter: { myHandle, contestId: p.contestId, index: p.index },
                update: { $set: doc },
                upsert: true,
            },
        });
    }

    // ✅ one round-trip for ALL upserts
    if (bulkOps.length > 0) {
        await Backlog.bulkWrite(bulkOps, { ordered: false });
    }

    // ✅ one round-trip to delete solved problems
    if (mySolvedKeys.size > 0) {
        await Backlog.deleteMany({
            myHandle,
            $or: [...mySolvedKeys].map(key => {
                const [contestId, index] = key.split("-");
                return { contestId: Number(contestId), index };
            }),
        });
    }

    backlog.sort((a, b) => {
        if (a.nearMyRating && !b.nearMyRating) return -1;
        if (!a.nearMyRating && b.nearMyRating) return 1;
        return b.friendSolveCount - a.friendSolveCount;
    });

    return {
        backlog,
        total: backlog.length,
        nearMyRating: backlog.filter(p => p.nearMyRating).length,
        practiceRating,
    };
};

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH ROUTES (no middleware)
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/auth/check — does this handle exist in DB?
app.post("/api/auth/check", async (req, res) => {
    const { handle } = req.body;
    if (!handle) return res.status(400).json({ error: "handle required." });
    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.json({ exists: false });
        return res.json({ exists: true, hasPassword: !!settings.passwordHash });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/auth/register — new user: validate CF handle, create account, set password, return JWT
app.post("/api/auth/register", async (req, res) => {
    const { handle, password, practiceRating, friendHandles } = req.body;
    if (!handle || !password) return res.status(400).json({ error: "handle and password required." });
    if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters." });
    try {
        // Validate CF handle exists
        let cfUser;
        try {
            const result = await cfFetch(`https://codeforces.com/api/user.info?handles=${handle}`);
            cfUser = result[0];
        } catch {
            return res.status(400).json({ error: "CF handle not found. Check spelling." });
        }

        // Check not already registered
        const existing = await UserSettings.findOne({ myHandle: handle });
        if (existing) return res.status(409).json({ error: "Handle already registered. Please log in." });

        const passwordHash = await bcrypt.hash(password, 10);
        const pr = practiceRating ? Number(practiceRating) : (cfUser.rating || 1200);

        await UserSettings.create({
            myHandle: handle,
            friendHandles: friendHandles || [],
            practiceRating: pr,
            currentRating: cfUser.rating || 0,
            ratingRange: 200,
            passwordHash,
            updatedAt: new Date(),
        });

        const token = signToken(handle);
        res.json({
            success: true,
            token,
            user: {
                handle,
                practiceRating: pr,
                currentRating: cfUser.rating || 0,
                friendHandles: friendHandles || [],
                ratingRange: 200,
            },
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/auth/login — existing user login, returns JWT
app.post("/api/auth/login", async (req, res) => {
    const { handle, password } = req.body;
    if (!handle || !password) return res.status(400).json({ error: "handle and password required." });
    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.status(404).json({ error: "Handle not found." });

        if (!settings.passwordHash) {
            // Legacy account with no password — set it now
            const hash = await bcrypt.hash(password, 10);
            await UserSettings.findOneAndUpdate({ myHandle: handle }, { passwordHash: hash });
        } else {
            const match = await bcrypt.compare(password, settings.passwordHash);
            if (!match) return res.status(401).json({ error: "Incorrect password." });
        }

        const token = signToken(handle);
        res.json({
            success: true,
            token,
            user: {
                handle: settings.myHandle,
                practiceRating: settings.practiceRating,
                currentRating: settings.currentRating,
                friendHandles: settings.friendHandles || [],
                ratingRange: settings.ratingRange ?? 200,
            },
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/auth/refresh — validate existing token, return fresh user data
app.post("/api/auth/refresh", requireAuth, async (req, res) => {
    try {
        const settings = await UserSettings.findOne({ myHandle: req.userHandle });
        if (!settings) return res.status(404).json({ error: "User not found." });
        // Issue a fresh token
        const token = signToken(req.userHandle);
        res.json({
            success: true,
            token,
            user: {
                handle: settings.myHandle,
                practiceRating: settings.practiceRating,
                currentRating: settings.currentRating,
                friendHandles: settings.friendHandles || [],
                ratingRange: settings.ratingRange ?? 200,
            },
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/auth/change-password
app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ error: "oldPassword and newPassword required." });
    if (newPassword.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters." });
    try {
        const settings = await UserSettings.findOne({ myHandle: req.userHandle });
        if (!settings) return res.status(404).json({ error: "User not found." });
        if (settings.passwordHash) {
            const match = await bcrypt.compare(oldPassword, settings.passwordHash);
            if (!match) return res.status(401).json({ error: "Current password incorrect." });
        }
        const hash = await bcrypt.hash(newPassword, 10);
        await UserSettings.findOneAndUpdate({ myHandle: req.userHandle }, { passwordHash: hash });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PROTECTED ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

app.post("/api/setup", requireAuth, async (req, res) => {
    const { friendHandles, practiceRating, ratingRange } = req.body;
    const myHandle = req.userHandle;
    try {
        let currentRating;
        try {
            const allHandles = [myHandle, ...(friendHandles || [])].filter(Boolean);
            const result = await cfFetch(`https://codeforces.com/api/user.info?handles=${allHandles.join(";")}`);
            const myInfo = result.find(u => u.handle.toLowerCase() === myHandle.toLowerCase());
            if (myInfo?.rating) currentRating = myInfo.rating;
        } catch {
            return res.status(400).json({ error: "One or more CF handles not found." });
        }

        const existing = await UserSettings.findOne({ myHandle });
        const finalFriends = (friendHandles && friendHandles.length > 0) ? friendHandles : (existing?.friendHandles || []);

        await UserSettings.findOneAndUpdate(
            { myHandle },
            {
                friendHandles: finalFriends,
                practiceRating: practiceRating || currentRating,
                currentRating,
                ...(ratingRange !== undefined && { ratingRange: Number(ratingRange) }),
                updatedAt: new Date(),
            },
            { upsert: true, new: true }
        );

        if (finalFriends.length !== (existing?.friendHandles?.length || 0) ||
            finalFriends.some((f, i) => f !== (existing?.friendHandles || [])[i])) {
            try { await rebuildBacklog(myHandle); } catch { }
        }

        res.json({ success: true, currentRating, practiceRating: practiceRating || currentRating, friendHandles: finalFriends });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/friends/sync/stream", (req, res, next) => {
    if (req.query.token) req.headers["authorization"] = `Bearer ${req.query.token}`;
    next();
},
    requireAuth,
    async (req, res) => {
        const handle = req.userHandle;
        const selectedFriends = req.query.friends
            ? req.query.friends.split(",").filter(Boolean)
            : null;

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();

        const send = (event, data) => {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
            if (res.flush) res.flush();
        };

        try {
            const settings = await UserSettings.findOne({ myHandle: handle });
            if (!settings) { send("error", { message: "Run setup first." }); return res.end(); }

            const friendsToFetch = selectedFriends
                ? settings.friendHandles.filter(f => selectedFriends.includes(f))
                : settings.friendHandles;

            // ── your submissions ───────────────────────────────────────────────────
            send("progress", { step: "you", message: `Fetching your submissions...` });

            const myCache = await UserSolvedCache.findOne({ myHandle: handle });
            const myLastTime = myCache?.lastSubmissionTime || 0;
            const mySubmissions = await cfFetch(
                `https://codeforces.com/api/user.status?handle=${handle}&count=500`
            );
            const newSolvedKeys = new Set(myCache?.solvedKeys || []);
            let myNewestTime = myLastTime, myNewCount = 0;

            for (const sub of mySubmissions) {
                if (sub.creationTimeSeconds <= myLastTime) break;
                if (sub.creationTimeSeconds > myNewestTime) myNewestTime = sub.creationTimeSeconds;
                if (sub.verdict === "OK" && sub.problem.contestId) {
                    const key = `${sub.problem.contestId}-${sub.problem.index}`;
                    if (!newSolvedKeys.has(key)) { newSolvedKeys.add(key); myNewCount++; }
                }
            }
            await UserSolvedCache.findOneAndUpdate(
                { myHandle: handle },
                { myHandle: handle, solvedKeys: [...newSolvedKeys], lastSubmissionTime: myNewestTime, updatedAt: new Date() },
                { upsert: true, new: true }
            );
            send("progress", {
                step: "you_done",
                message: `Found ${mySubmissions.length} submissions · ${myNewCount} newly solved`,
                count: mySubmissions.length, newSolved: myNewCount,
            });

            // ── each selected friend ───────────────────────────────────────────────
            const results = [];
            for (let i = 0; i < friendsToFetch.length; i++) {
                const friend = friendsToFetch[i];
                send("progress", {
                    step: "friend_start", friend, index: i + 1, total: friendsToFetch.length,
                    message: `Fetching ${friend}'s submissions... (${i + 1}/${friendsToFetch.length})`,
                });

                const cached = await FriendProblems.findOne({ handle: friend });
                const lastTime = cached?.lastSubmissionTime || 0;
                const submissions = await cfFetch(
                    `https://codeforces.com/api/user.status?handle=${friend}&count=500`
                );

                const existingSolvedKeys = new Set((cached?.solved || []).map(p => `${p.contestId}-${p.index}`));
                const existingAttemptedKeys = new Set((cached?.attempted || []).map(p => `${p.contestId}-${p.index}`));
                const newSolved = [...(cached?.solved || [])];
                const newAttempted = [...(cached?.attempted || [])];
                let newestTime = lastTime, addedSolved = 0, addedAttempted = 0;

                for (const sub of submissions) {
                    if (sub.creationTimeSeconds <= lastTime) break;
                    if (!sub.problem.contestId) continue;
                    const key = `${sub.problem.contestId}-${sub.problem.index}`;
                    if (sub.creationTimeSeconds > newestTime) newestTime = sub.creationTimeSeconds;
                    const problem = {
                        contestId: sub.problem.contestId, index: sub.problem.index,
                        name: sub.problem.name, rating: sub.problem.rating || null,
                        tags: sub.problem.tags || [],
                        url: `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`,
                    };
                    if (sub.verdict === "OK") {
                        if (!existingSolvedKeys.has(key)) {
                            existingSolvedKeys.add(key); newSolved.push(problem); addedSolved++;
                            const idx = newAttempted.findIndex(p => `${p.contestId}-${p.index}` === key);
                            if (idx !== -1) newAttempted.splice(idx, 1);
                        }
                    } else {
                        if (!existingSolvedKeys.has(key) && !existingAttemptedKeys.has(key)) {
                            existingAttemptedKeys.add(key); newAttempted.push(problem); addedAttempted++;
                        }
                    }
                }

                await FriendProblems.findOneAndUpdate(
                    { handle: friend },
                    { handle: friend, solved: newSolved, attempted: newAttempted, lastSubmissionTime: newestTime, updatedAt: new Date() },
                    { upsert: true, new: true }
                );
                send("progress", {
                    step: "friend_done", friend, index: i + 1, total: friendsToFetch.length,
                    message: `${friend} · ${submissions.length} submissions · +${addedSolved} solved · +${addedAttempted} attempted`,
                    submissionCount: submissions.length, addedSolved, addedAttempted,
                });
                results.push({ friend, addedSolved, addedAttempted });
            }

            // ── rebuild backlog ────────────────────────────────────────────────────
            send("progress", { step: "backlog", message: "Rebuilding your backlog..." });
            const backlogData = await rebuildBacklog(handle);
            send("done", { success: true, myNewSolved: myNewCount, friends: results, ...backlogData });

        } catch (err) {
            send("error", { message: err.message });
        }
        res.end();
    }
);

// ── backlog GET route (separate, unchanged) ───────────────────────────────────
app.get("/api/backlog", requireAuth, async (req, res) => {
    const handle = req.userHandle;
    const quickLoad = req.query.quick === "1";
    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.status(404).json({ error: "Run /api/setup first." });
        const { practiceRating, friendHandles } = settings;
        const myCache = await UserSolvedCache.findOne({ myHandle: handle });
        const mySolvedKeys = new Set(myCache?.solvedKeys || []);
        const completedStates = await ProgressState.find({ myHandle: handle, state: "solved" });
        const completedProblemKeys = new Set(completedStates.map(s => s.key.slice(s.key.indexOf("-") + 1)));

        const query = Backlog.find({ myHandle: handle }).sort({ nearMyRating: -1, friendSolveCount: -1 });
        if (quickLoad) query.limit(60);

        const allBacklog = await query;
        const backlog = allBacklog
            .filter(p => {
                const key = `${p.contestId}-${p.index}`;
                if (mySolvedKeys.has(key)) return false;
                if (completedProblemKeys.has(key)) return false;
                return p.solvedBy?.some(f => friendHandles.includes(f)) ||
                    p.attemptedBy?.some(f => friendHandles.includes(f));
            })
            .map(p => ({
                ...p.toObject(),
                solvedBy: p.solvedBy?.filter(f => friendHandles.includes(f)),
                attemptedBy: p.attemptedBy?.filter(f => friendHandles.includes(f)),
                friendSolveCount: p.solvedBy?.filter(f => friendHandles.includes(f)).length,
            }));

        res.json({
            success: true,
            total: backlog.length,
            nearMyRating: backlog.filter(p => p.nearMyRating).length,
            practiceRating, backlog,
            lastSynced: allBacklog[0]?.updatedAt || null,
            isPartial: quickLoad,
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/analyze", requireAuth, async (req, res) => {
    const { days } = req.body;
    const handle = req.userHandle;
    if (!days) return res.status(400).json({ error: "days required." });
    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.status(404).json({ error: "Run /api/setup first." });
        const { practiceRating } = settings;
        const cutoff = Date.now() / 1000 - days * 86400;
        const allSubmissions = await cfFetch(`https://codeforces.com/api/user.status?handle=${handle}&count=10000`);
        const recent = allSubmissions.filter(s => s.creationTimeSeconds >= cutoff);
        if (recent.length === 0) return res.status(400).json({ error: `No submissions found in last ${days} days.` });

        const questions = {};
        const topicStats = {};
        for (const sub of recent) {
            const tags = sub.problem.tags || [];
            const key = `${sub.problem.contestId}-${sub.problem.index}`;
            if (!questions[key]) questions[key] = { contestId: sub.problem.contestId, index: sub.problem.index, name: sub.problem.name, tags, rating: sub.problem.rating, attempts: 0, solved: false, url: `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}` };
            questions[key].attempts++;
            if (sub.verdict === "OK") questions[key].solved = true;
            for (const tag of tags) {
                if (!topicStats[tag]) topicStats[tag] = { attempted: 0, solved: 0 };
                topicStats[tag].attempted++;
                if (sub.verdict === "OK") topicStats[tag].solved++;
            }
        }

        const allQuestions = Object.values(questions);
        const solvedKeys = new Set(allQuestions.filter(q => q.solved).map(q => `${q.contestId}-${q.index}`));
        const unsolvedQuestions = allQuestions.filter(q => !q.solved).sort((a, b) => b.attempts - a.attempts);

        const groqPrompt = `You are a competitive programming coach.
User's practice rating: ${practiceRating}
User's current CF rating: ${settings.currentRating}
Analysis period: last ${days} days. Total submissions: ${recent.length}
Problems user struggled with most: ${JSON.stringify(unsolvedQuestions.slice(0, 15), null, 2)}
Problems user solved: ${JSON.stringify(allQuestions.filter(q => q.solved).slice(0, 15), null, 2)}
Identify the top 5 weakest topics. Only include a topic if it has been attempted enough times with low accuracy.
Respond ONLY with valid JSON:
{"weakTopics":[{"topic":"binary search","accuracy":35,"attempted":17,"solved":6,"reason":"17 attempts only 6 solved"}],"summary":"2 sentence analysis"}`;

        const completion = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [{ role: "user", content: groqPrompt }],
            max_tokens: 600, temperature: 0.2,
        });

        let analysis;
        try {
            const raw = completion.choices[0].message.content;
            analysis = JSON.parse(raw.replace(/```json|```/g, "").trim());
        } catch { return res.status(500).json({ error: "Groq returned invalid JSON. Try again." }); }

        const weakTopicNames = analysis.weakTopics.map(t => t.topic);
        const cfProblems = await cfFetch("https://codeforces.com/api/problemset.problems");
        await PriorityQueue.deleteMany({ myHandle: handle, fromBacklog: { $ne: true } });

        const allCandidates = [];
        const seen = new Set();
        const backlogDocs = await Backlog.find({ myHandle: handle });
        const friendSolveCountMap = {};
        for (const doc of backlogDocs) friendSolveCountMap[`${doc.contestId}-${doc.index}`] = doc.friendSolveCount || 0;

        for (const weakTopic of analysis.weakTopics) {
            const tag = weakTopic.topic;
            const matching = cfProblems.problems.filter(p => {
                const key = `${p.contestId}-${p.index}`;
                return p.rating && p.rating >= practiceRating - 100 && p.rating <= practiceRating + 300 && p.tags?.includes(tag) && !solvedKeys.has(key) && p.contestId;
            }).sort(() => Math.random() - 0.5).slice(0, 12);

            for (const p of matching) {
                const key = `${p.contestId}-${p.index}`;
                if (seen.has(key)) { const ex = allCandidates.find(c => c.key === key); if (ex) ex.score += 10; continue; }
                seen.add(key);
                const weakTopicsCovered = p.tags.filter(t => weakTopicNames.includes(t));
                const ratingBonus = Math.max(0, 10 - Math.floor(Math.abs(p.rating - practiceRating) / 50));
                const score = (weakTopicsCovered.length * 10) + ratingBonus + (friendSolveCountMap[key] || 0) * 5;
                allCandidates.push({ key, contestId: p.contestId, index: p.index, name: p.name, rating: p.rating, tags: p.tags, primaryTopic: tag, url: `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,  score });
            }
        }

        const backlogItems = await PriorityQueue.find({ myHandle: handle, fromBacklog: true, done: false });
        const backlogCandidates = [];
        for (const p of backlogItems) {
            const key = `${p.contestId}-${p.index}`;
            if (solvedKeys.has(key)) continue;
            const weakTopicsCovered = (p.tags || []).filter(t => weakTopicNames.includes(t));
            const ratingBonus = p.rating ? Math.max(0, 10 - Math.floor(Math.abs(p.rating - practiceRating) / 50)) : 0;
            const score = (weakTopicsCovered.length * 10) + ratingBonus + (friendSolveCountMap[key] || 0) * 5;
            backlogCandidates.push({ key, contestId: p.contestId, index: p.index, name: p.name, rating: p.rating, tags: p.tags || [], primaryTopic: p.topic, url: p.url, score, fromBacklog: true });
            await PriorityQueue.deleteOne({ myHandle: handle, contestId: p.contestId, index: p.index });
        }

        const merged = [...allCandidates, ...backlogCandidates].sort((a, b) => b.score - a.score);
        for (let i = 0; i < merged.length; i++) {
            const p = merged[i];
            await PriorityQueue.create({
                myHandle: handle, contestId: p.contestId, index: p.index, name: p.name,
                rating: p.rating, tags: p.tags, topic: p.primaryTopic, priority: i + 1,
                url: p.url || `...`, done: false, fromBacklog: p.fromBacklog || false,
                score: p.score || 0,
                friendSolveCount: friendSolveCountMap[`${p.contestId}-${p.index}`] || 0,
            });
        }

        const savedCount = await PriorityQueue.countDocuments({ myHandle: handle });
        res.json({ success: true, submissionsAnalyzed: recent.length, weakTopics: analysis.weakTopics, summary: analysis.summary, priorityQueueSize: savedCount, lastAnalysisDays: days, topProblems: allCandidates.slice(0, 10) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/plan", requireAuth, async (req, res) => {
    const { days } = req.body;
    const handle = req.userHandle;
    if (!days) return res.status(400).json({ error: "days required." });
    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        const queue = await PriorityQueue.find({ myHandle: handle, done: false }).sort({ priority: 1 });
        if (queue.length === 0) return res.status(400).json({ error: "Priority queue empty. Run /api/analyze first." });

        const PROBLEMS_PER_DAY = Math.ceil(queue.length / days); // ✅ moved here

        // backlog-based friend counts
        const backlogDocs = await Backlog.find({ myHandle: handle });
        const friendSolveCountMap = {};
        for (const doc of backlogDocs)
            friendSolveCountMap[`${doc.contestId}-${doc.index}`] = doc.friendSolveCount || 0;

        // fallback: count from FriendProblems for AI-recommended problems not in backlog
        const allFriendCaches = await FriendProblems.find({ handle: { $in: settings.friendHandles } });
        const friendSolveFromCache = {};
        for (const fc of allFriendCaches) {
            for (const p of fc.solved) {
                const key = `${p.contestId}-${p.index}`;
                friendSolveFromCache[key] = (friendSolveFromCache[key] || 0) + 1;
            }
        }

        // single function used everywhere
        const getFriendCount = (contestId, index) => {
            const key = `${contestId}-${index}`;
            return friendSolveCountMap[key] ?? friendSolveFromCache[key] ?? 0;
        };

        const byTopic = {};
        for (const p of queue) { if (!byTopic[p.topic]) byTopic[p.topic] = []; byTopic[p.topic].push(p); }
        const topicQueues = Object.values(byTopic);
        const interleaved = [];
        let i = 0;
        while (interleaved.length < queue.length) {
            const tq = topicQueues[i % topicQueues.length];
            if (tq && tq.length > 0) interleaved.push(tq.shift());
            i++;
            if (topicQueues.every(tq => tq.length === 0)) break;
        }

        await Plan.deleteMany({ myHandle: handle });
        const today = new Date();
        const planResult = [];
        for (let day = 1; day <= days; day++) {
            const dayProblems = interleaved.slice((day - 1) * PROBLEMS_PER_DAY, day * PROBLEMS_PER_DAY);
            if (dayProblems.length === 0) break;
            const date = new Date(today);
            date.setDate(today.getDate() + day - 1);
            await Plan.create({
                myHandle: handle, day, date,
                todos: dayProblems.map(p => ({
                    contestId: p.contestId, index: p.index, name: p.name,
                    rating: p.rating, url: p.url, topic: p.topic, done: false,
                    friendSolveCount: getFriendCount(p.contestId, p.index),
                    score: p.score || 0,
                }))
            });
            planResult.push({
                day, date,
                focus: [...new Set(dayProblems.map(p => p.topic))].join(" + "),
                problemCount: dayProblems.length,
                problems: dayProblems.map(p => ({
                    contestId: p.contestId, index: p.index, name: p.name,
                    rating: p.rating, topic: p.topic, url: p.url,
                    friendSolveCount: getFriendCount(p.contestId, p.index),
                    score: p.score || 0,
                }))
            });
        }
        res.json({ success: true, totalDays: planResult.length, problemsPerDay: PROBLEMS_PER_DAY, totalProblems: interleaved.length, plan: planResult });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/complete", requireAuth, async (req, res) => {
    const { day, contestId, index } = req.body;
    const handle = req.userHandle;
    try {
        const dayPlan = await Plan.findOne({ myHandle: handle, day });
        if (!dayPlan) return res.status(404).json({ error: "Day plan not found." });
        const todo = dayPlan.todos.find(t => t.contestId === contestId && t.index === index);
        if (!todo) return res.status(404).json({ error: "Todo not found." });
        todo.done = true;
        await dayPlan.save();
        await PriorityQueue.findOneAndUpdate({ myHandle: handle, contestId, index }, { done: true });
        const done = dayPlan.todos.filter(t => t.done).length;
        res.json({ success: true, progress: `${done}/${dayPlan.todos.length}`, dayComplete: done === dayPlan.todos.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/uncomplete", requireAuth, async (req, res) => {
    const { day, contestId, index } = req.body;
    const handle = req.userHandle;
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

app.post("/api/verify", requireAuth, async (req, res) => {
    const { contestId, index } = req.body;
    const handle = req.userHandle;
    try {
        const submissions = await cfFetch(`https://codeforces.com/api/user.status?handle=${handle}&count=500`);
        const solved = submissions.some(s => s.problem.contestId === Number(contestId) && s.problem.index === index && s.verdict === "OK");
        res.json({ solved });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/queue/add", requireAuth, async (req, res) => {
    const { contestId, index, name, rating, practiceRating, tags, topic, weakTopicNames, url } = req.body;
    const handle = req.userHandle;
    try {
        const existing = await PriorityQueue.findOne({ myHandle: handle, contestId, index });
        if (existing) return res.json({ success: true, alreadyExists: true });

        // ✅ look up friendSolveCount from backlog
        const backlogDoc = await Backlog.findOne({ myHandle: handle, contestId: Number(contestId), index });
        const friendSolveCount = backlogDoc?.friendSolveCount || 0;

        const weakTopicsCovered = (backlogDoc?.tags || []).filter(t => weakTopicNames.includes(t));
        const ratingBonus = backlogDoc?.rating ? Math.max(0, 10 - Math.floor(Math.abs(backlogDoc?.rating - practiceRating) / 50)) : 0;
        const score = (weakTopicsCovered.length * 10) + ratingBonus + (friendSolveCount || 0) * 5;

        const last = await PriorityQueue.findOne({ myHandle: handle }).sort({ priority: -1 });
        await PriorityQueue.create({
            myHandle: handle, contestId: Number(contestId), index, name, rating,
            tags: tags || [], topic: topic || "backlog",
            priority: last ? last.priority + 1 : 1,
            url: url || `https://codeforces.com/problemset/problem/${contestId}/${index}`,
            done: false, fromBacklog: true,
            score,
            friendSolveCount, // ✅
        });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/queue/added", requireAuth, async (req, res) => {
    const handle = req.userHandle;
    try {
        const queue = await PriorityQueue.find({ myHandle: handle });
        res.json({ success: true, keys: queue.map(p => `${p.contestId}-${p.index}`) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/profile", requireAuth, async (req, res) => {
    const handle = req.userHandle;
    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.status(404).json({ error: "Not found." });
        const queue = await PriorityQueue.find({ myHandle: handle }).sort({ priority: 1 });
        const plans = await Plan.find({ myHandle: handle }).sort({ day: 1 });
        const totalSolved = await PriorityQueue.countDocuments({ myHandle: handle, done: true });
        res.json({ success: true, settings, queueSize: queue.length, plans, totalSolved });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/progress/save", requireAuth, async (req, res) => {
    const { key, state, problem, day } = req.body;
    const handle = req.userHandle;
    try {
        await ProgressState.findOneAndUpdate(
            { myHandle: handle, key },
            { myHandle: handle, key, state, problem, day, updatedAt: new Date() },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/progress/load", requireAuth, async (req, res) => {
    const handle = req.userHandle;
    try {
        const states = await ProgressState.find({ myHandle: handle });
        const map = {};
        for (const s of states) map[s.key] = { key: s.key, state: s.state, problem: s.problem, day: s.day };
        res.json({ success: true, states: map });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
    console.log(`\n✅ CF Tracker server running on http://localhost:${PORT}`);
});