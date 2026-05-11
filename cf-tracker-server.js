import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import Groq from "groq-sdk";
import bcrypt from "bcryptjs";

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
    ratingRange: { type: Number, default: 200 },
    passwordHash: { type: String, default: null },
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

const friendProblemsSchema = new mongoose.Schema({
    handle: { type: String, required: true, unique: true },
    solved: [{ contestId: Number, index: String, name: String, rating: Number, tags: [String], url: String }],
    attempted: [{ contestId: Number, index: String, name: String, rating: Number, tags: [String], url: String }],
    lastSubmissionTime: { type: Number, default: 0 },
    updatedAt: { type: Date, default: Date.now },
});
const FriendProblems = mongoose.model("FriendProblems", friendProblemsSchema);

// Cache of user's own solved problems
const userSolvedCacheSchema = new mongoose.Schema({
    myHandle: { type: String, required: true, unique: true },
    solvedKeys: [String], // "contestId-index"
    lastSubmissionTime: { type: Number, default: 0 }, // unix timestamp
    updatedAt: { type: Date, default: Date.now },
});
const UserSolvedCache = mongoose.model("UserSolvedCache", userSolvedCacheSchema);

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

// ─── Auth middleware ──────────────────────────────────────────────────────────
const requireAuth = async (req, res, next) => {
    const handle = req.body?.handle || req.body?.myHandle || req.query?.handle;
    const password = req.headers["x-password"];

    if (!handle) return res.status(400).json({ error: "handle required." });

    const settings = await UserSettings.findOne({ myHandle: handle });
    if (!settings) return next();
    if (!settings.passwordHash) return next();
    if (!password) return res.status(401).json({ error: "Password required.", needsPassword: true });

    const match = await bcrypt.compare(password, settings.passwordHash);
    if (!match) return res.status(401).json({ error: "Incorrect password.", needsPassword: true });

    next();
};

const jwt = require("jsonwebtoken");

const generateToken = (user) => {
    return jwt.sign(
        { handle: user.handle },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
    );
};

// ─── ROUTE: POST /api/auth/set-password ──────────────────────────────────────
// Set password for first time, or change it (requires old password if one exists)
app.post("/api/auth/set-password", async (req, res) => {
    const { handle, oldPassword, newPassword } = req.body;
    if (!handle || !newPassword) {
        return res.status(400).json({ error: "handle and newPassword required." });
    }
    if (newPassword.length < 4) {
        return res.status(400).json({ error: "Password must be at least 4 characters." });
    }
    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.status(404).json({ error: "Run /api/setup first." });

        // If password already set, verify old password
        if (settings.passwordHash) {
            if (!oldPassword) return res.status(401).json({ error: "Current password required to change password." });
            const match = await bcrypt.compare(oldPassword, settings.passwordHash);
            if (!match) return res.status(401).json({ error: "Current password incorrect." });
        }

        const hash = await bcrypt.hash(newPassword, 10);
        await UserSettings.findOneAndUpdate({ myHandle: handle }, { passwordHash: hash });

        res.json({ success: true, message: "Password updated." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// ─── ROUTE: POST /api/auth/login ─────────────────────────────────────────────
// Verify handle + password, returns whether account has a password set
app.post("/api/auth/login", async (req, res) => {
    const { handle, password } = req.body;
    if (!handle) return res.status(400).json({ error: "handle required." });
    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.status(404).json({ error: "Handle not found. Run setup first." });
        
        if (!settings.passwordHash) {
            // No password set — log them straight in, prompt to set one
            return res.json({ success: true, noPasswordSet: true });
        }
        
        if (!password) return res.status(401).json({ error: "Password required.", needsPassword: true });
        
        const match = await bcrypt.compare(password, settings.passwordHash);
        if (!match) return res.status(401).json({ error: "Incorrect password." });
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


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

const syncFriend = async (friendHandle) => {
    const existing = await FriendProblems.findOne({ handle: friendHandle });

    let submissions;

    if (!existing) {
        console.log(`[Sync] First time fetching all submissions for ${friendHandle}`);
        submissions = await cfFetch(
            `https://codeforces.com/api/user.status?handle=${friendHandle}&count=10000`
        );
    } else {
        const lastFetch = Math.floor(new Date(existing.updatedAt).getTime() / 1000);
        console.log(`[Sync] Fetching new submissions for ${friendHandle} since ${existing.updatedAt}`);
        submissions = await cfFetch(
            `https://codeforces.com/api/user.status?handle=${friendHandle}&count=10000`
        );
        submissions = submissions.filter(s => s.creationTimeSeconds > lastFetch);
        console.log(`[Sync] ${submissions.length} new submissions found for ${friendHandle}`);
    }

    if (submissions.length === 0) {
        console.log(`[Sync] No new submissions for ${friendHandle}, skipping.`);
        return;
    }

    const existingSolvedKeys = new Set(
        (existing?.solved || []).map(p => `${p.contestId}-${p.index}`)
    );
    const existingAttemptedKeys = new Set(
        (existing?.attempted || []).map(p => `${p.contestId}-${p.index}`)
    );

    const newSolved = [];
    const newAttempted = [];
    const seenInThisBatch = new Set();

    for (const sub of submissions) {
        if (!sub.problem.contestId) continue;
        const key = `${sub.problem.contestId}-${sub.problem.index}`;
        if (seenInThisBatch.has(key)) continue;
        seenInThisBatch.add(key);

        const problem = {
            contestId: sub.problem.contestId,
            index: sub.problem.index,
            name: sub.problem.name,
            rating: sub.problem.rating || null,
            tags: sub.problem.tags || [],
            url: `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`,
        };

        if (sub.verdict === "OK" && !existingSolvedKeys.has(key)) {
            newSolved.push(problem);
            existingAttemptedKeys.delete(key);
        } else if (sub.verdict !== "OK" && !existingSolvedKeys.has(key) && !existingAttemptedKeys.has(key)) {
            newAttempted.push(problem);
        }
    }

    if (!existing) {
        await FriendProblems.create({
            handle: friendHandle,
            solved: newSolved,
            attempted: newAttempted,
            updatedAt: new Date(),
        });
    } else {
        // Push new problems in
        await FriendProblems.findOneAndUpdate(
            { handle: friendHandle },
            {
                $push: { solved: { $each: newSolved }, attempted: { $each: newAttempted } },
                updatedAt: new Date(),
            }
        );
        // Remove from attempted if now solved — match both contestId AND index
        for (const p of newSolved) {
            await FriendProblems.findOneAndUpdate(
                { handle: friendHandle },
                { $pull: { attempted: { contestId: p.contestId, index: p.index } } }
            );
        }
    }

    console.log(`[Sync] Saved ${newSolved.length} new solved, ${newAttempted.length} new attempted for ${friendHandle}`);
};

// ─── Helper: rebuild backlog from DB cache ────────────────────────────────────
const rebuildBacklog = async (myHandle) => {
    const settings = await UserSettings.findOne({ myHandle });
    if (!settings) throw new Error("User not found.");

    const { friendHandles, practiceRating, ratingRange } = settings;
    const RATING_RANGE = ratingRange ?? 200;

    // Get your solved keys from cache
    const myCache = await UserSolvedCache.findOne({ myHandle });
    const mySolvedKeys = new Set(myCache?.solvedKeys || []);

    // Build problem map from cached FriendProblems
    const problemMap = {};

    for (const friend of friendHandles) {
        const cached = await FriendProblems.findOne({ handle: friend });
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
            if (!problemMap[key].solvedBy.includes(friend) && !problemMap[key].attemptedBy.includes(friend)) {
                problemMap[key].attemptedBy.push(friend);
            }
        }
    }

    // Upsert each problem into Backlog collection
    const backlog = [];
    for (const [key, data] of Object.entries(problemMap)) {
        const p = data.problem;
        const nearMyRating = p.rating
            ? Math.abs(p.rating - practiceRating) <= RATING_RANGE
            : false;

        const doc = {
            key,
            contestId: p.contestId,
            index: p.index,
            name: p.name,
            rating: p.rating,
            tags: p.tags,
            solvedBy: data.solvedBy,
            attemptedBy: data.attemptedBy,
            friendSolveCount: data.solvedBy.length,
            nearMyRating,
            url: p.url,
            myHandle,
            updatedAt: new Date(),
        };

        await Backlog.findOneAndUpdate(
            { myHandle, contestId: p.contestId, index: p.index },
            doc,
            { upsert: true, new: true }
        );
        backlog.push(doc);
    }

    // Remove problems from backlog that user has now solved
    await Backlog.deleteMany({ myHandle, key: { $in: [...mySolvedKeys] } });

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


// ─── ROUTE 1: POST /api/setup ─────────────────────────────────────────────────
// Save your CF handle, friends, and practice rating
app.post("/api/setup", requireAuth, async (req, res) => {
    const { myHandle, friendHandles, practiceRating, ratingRange } = req.body;

    if (!myHandle) return res.status(400).json({ error: "myHandle is required." });
    if (!Array.isArray(friendHandles)) {
        return res.status(400).json({ error: "friendHandles must be an array." });
    }


    try {
        // Validate all handles exist on CF
        let currentRating;
        console.log(`[Setup] Validating handles...`);
        // Validate all handles at once using CF batch endpoint
        try {
            const allHandles = [myHandle, ...friendHandles].filter(Boolean);
            const result = await cfFetch(
                `https://codeforces.com/api/user.info?handles=${allHandles.join(";")}`
            );
            // Get current rating for myHandle
            const myInfo = result.find(u => u.handle.toLowerCase() === myHandle.toLowerCase());
            if (myInfo?.rating) {
                currentRating = myInfo.rating;
                console.log(`[Setup] ${myHandle} current rating: ${currentRating}`);
            }
        } catch (e) {
            return res.status(400).json({ error: `One or more CF handles not found. Check spelling.` });
        }


        // Get existing friends if new list is empty
        const existing = await UserSettings.findOne({ myHandle });
        const finalFriends = (friendHandles && friendHandles.length > 0)
            ? friendHandles
            : (existing?.friendHandles || []);

        await UserSettings.findOneAndUpdate(
            { myHandle },
            {
                myHandle,
                friendHandles: finalFriends,
                practiceRating: practiceRating || currentRating,
                currentRating,
                ...(ratingRange !== undefined && { ratingRange: Number(ratingRange) }),
                updatedAt: new Date(),
            },
            { upsert: true, new: true }
        );


        // If friendHandles changed, rebuild backlog to reflect current friends only
        if (finalFriends.length !== (existing?.friendHandles?.length || 0) ||
            finalFriends.some((f, i) => f !== (existing?.friendHandles || [])[i])) {
            try {
                await rebuildBacklog(myHandle);
                console.log(`[Setup] Backlog rebuilt after friends change.`);
            } catch (e) {
                console.log(`[Setup] Backlog rebuild skipped:`, e.message);
            }
        }

        console.log(`[Setup] Saved settings for ${myHandle}`);
        res.json({
            success: true,
            message: `Setup complete for ${myHandle}`,
            currentRating,
            practiceRating: practiceRating || currentRating,
            friendHandles: finalFriends,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


app.post("/api/friends/sync", requireAuth, async (req, res) => {
    const { handle } = req.body;
    if (!handle) return res.status(400).json({ error: "handle required." });

    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.status(404).json({ error: "Run setup first." });

        const { friendHandles } = settings;
        const results = [];

        // ── Step 1: Update YOUR solved cache ─────────────────────────────────
        console.log(`[Sync] Updating solved cache for ${handle}...`);
        const myCache = await UserSolvedCache.findOne({ myHandle: handle });
        const myLastTime = myCache?.lastSubmissionTime || 0;

        // Fetch recent submissions — stop when we hit ones older than lastSubmissionTime
        const mySubmissions = await cfFetch(
            `https://codeforces.com/api/user.status?handle=${handle}&count=500`
        );

        const newSolvedKeys = new Set(myCache?.solvedKeys || []);
        let myNewestTime = myLastTime;
        let myNewCount = 0;

        for (const sub of mySubmissions) {
            if (sub.creationTimeSeconds <= myLastTime) break; // stop at known submissions
            if (sub.creationTimeSeconds > myNewestTime) myNewestTime = sub.creationTimeSeconds;
            if (sub.verdict === "OK" && sub.problem.contestId) {
                const key = `${sub.problem.contestId}-${sub.problem.index}`;
                if (!newSolvedKeys.has(key)) {
                    newSolvedKeys.add(key);
                    myNewCount++;
                }
            }
        }

        await UserSolvedCache.findOneAndUpdate(
            { myHandle: handle },
            {
                myHandle: handle,
                solvedKeys: [...newSolvedKeys],
                lastSubmissionTime: myNewestTime,
                updatedAt: new Date(),
            },
            { upsert: true, new: true }
        );
        console.log(`[Sync] Your cache: ${myNewCount} new solved problems. Total: ${newSolvedKeys.size}`);

        // ── Step 2: Update each friend incrementally ──────────────────────────
        for (const friend of friendHandles) {
            const cached = await FriendProblems.findOne({ handle: friend });
            const lastTime = cached?.lastSubmissionTime || 0;

            console.log(`[Sync] Fetching new submissions for ${friend} since ${new Date(lastTime * 1000).toLocaleDateString()}...`);

            // Fetch up to 500 recent submissions — enough to catch up
            const submissions = await cfFetch(
                `https://codeforces.com/api/user.status?handle=${friend}&count=500`
            );

            const existingSolvedKeys = new Set((cached?.solved || []).map(p => `${p.contestId}-${p.index}`));
            const existingAttemptedKeys = new Set((cached?.attempted || []).map(p => `${p.contestId}-${p.index}`));
            const newSolved = [...(cached?.solved || [])];
            const newAttempted = [...(cached?.attempted || [])];

            let newestTime = lastTime;
            let addedSolved = 0, addedAttempted = 0;

            for (const sub of submissions) {
                if (sub.creationTimeSeconds <= lastTime) break; // only process new ones
                if (!sub.problem.contestId) continue;

                const key = `${sub.problem.contestId}-${sub.problem.index}`;
                if (sub.creationTimeSeconds > newestTime) newestTime = sub.creationTimeSeconds;

                const problem = {
                    contestId: sub.problem.contestId,
                    index: sub.problem.index,
                    name: sub.problem.name,
                    rating: sub.problem.rating || null,
                    tags: sub.problem.tags || [],
                    url: `https://codeforces.com/problemset/problem/${sub.problem.contestId}/${sub.problem.index}`,
                };

                if (sub.verdict === "OK") {
                    if (!existingSolvedKeys.has(key)) {
                        existingSolvedKeys.add(key);
                        newSolved.push(problem);
                        addedSolved++;
                        // Remove from attempted if they eventually solved it
                        const idx = newAttempted.findIndex(p => `${p.contestId}-${p.index}` === key);
                        if (idx !== -1) newAttempted.splice(idx, 1);
                    }
                } else {
                    if (!existingSolvedKeys.has(key) && !existingAttemptedKeys.has(key)) {
                        existingAttemptedKeys.add(key);
                        newAttempted.push(problem);
                        addedAttempted++;
                    }
                }
            }

            await FriendProblems.findOneAndUpdate(
                { handle: friend },
                {
                    handle: friend,
                    solved: newSolved,
                    attempted: newAttempted,
                    lastSubmissionTime: newestTime,
                    updatedAt: new Date(),
                },
                { upsert: true, new: true }
            );

            console.log(`[Sync] ${friend}: +${addedSolved} solved, +${addedAttempted} attempted`);
            results.push({
                friend,
                addedSolved,
                addedAttempted,
                totalSolved: newSolved.length,
                totalAttempted: newAttempted.length,
            });
        }

        // ── Step 3: Rebuild backlog from updated cache ────────────────────────
        console.log(`[Sync] Rebuilding backlog...`);
        const backlogData = await rebuildBacklog(handle);

        res.json({
            success: true,
            myNewSolved: myNewCount,
            friends: results,
            ...backlogData,
        });
    } catch (err) {
        console.error("[Sync] Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── ROUTE 2: GET /api/backlog?handle=YOUR_HANDLE ─────────────────────────────
// Fetch all problems friends solved/attempted that you haven't solved
app.get("/api/backlog", requireAuth, async (req, res) => {
    const { handle } = req.query;
    if (!handle) return res.status(400).json({ error: "handle required." });

    try {
        const settings = await UserSettings.findOne({ myHandle: handle });
        if (!settings) return res.status(404).json({ error: "Run /api/setup first." });

        const { practiceRating, friendHandles } = settings;

        // Get user's solved keys
        const myCache = await UserSolvedCache.findOne({ myHandle: handle });
        const mySolvedKeys = new Set(myCache?.solvedKeys || []);

        // Get verified-solved problems from progress states
        const completedStates = await ProgressState.find({ myHandle: handle, state: "solved" });
        const completedProblemKeys = new Set(
            completedStates.map(s => {
                // key format: "day-contestId-index" e.g. "1-2057-C"
                const idx = s.key.indexOf("-", s.key.indexOf("-") + 1);
                return s.key.slice(s.key.indexOf("-") + 1); // everything after first "-"
            })
        );

        const allBacklog = await Backlog.find({ myHandle: handle })
            .sort({ nearMyRating: -1, friendSolveCount: -1 });

        const backlog = allBacklog
            .filter(p => {
                const key = `${p.contestId}-${p.index}`;
                if (mySolvedKeys.has(key)) return false;
                if (completedProblemKeys.has(key)) return false;
                const hasCurrentFriendSolved = p.solvedBy?.some(f => friendHandles.includes(f));
                const hasCurrentFriendAttempted = p.attemptedBy?.some(f => friendHandles.includes(f));
                return hasCurrentFriendSolved || hasCurrentFriendAttempted;
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
            practiceRating,
            backlog,
            lastSynced: allBacklog[0]?.updatedAt || null,
        });
    } catch (err) {
        console.error("[Backlog] Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});


// ─── ROUTE 3: POST /api/analyze ───────────────────────────────────────────────
// Fetch last X days of your submissions, analyze weak topics with Groq,
// save recommended problems to priority queue
app.post("/api/analyze", requireAuth, async (req, res) => {
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

        // ── Score surviving backlog problems + merge with AI candidates ──────
        const backlogItems = await PriorityQueue.find({ myHandle: handle, fromBacklog: true, done: false });
        const backlogCandidates = [];

        const backlogDocs = await Backlog.find({ myHandle: handle });
        const friendSolveCountMap = {};
        for (const doc of backlogDocs) {
            const key = `${doc.contestId}-${doc.index}`;
            friendSolveCountMap[key] = doc.friendSolveCount || 0;
        }

        for (const p of backlogItems) {
            const key = `${p.contestId}-${p.index}`;
            if (solvedKeys.has(key)) continue;
            const weakTopicsCovered = (p.tags || []).filter(t => weakTopicNames.includes(t));
            const ratingBonus = p.rating ? Math.max(0, 10 - Math.floor(Math.abs(p.rating - practiceRating) / 50)) : 0;
            const friendBonus = (friendSolveCountMap[key] || 0) * 5;
            const score = (weakTopicsCovered.length * 10) + ratingBonus + friendBonus;
            backlogCandidates.push({ key, contestId: p.contestId, index: p.index, name: p.name, rating: p.rating, tags: p.tags || [], primaryTopic: p.topic, url: p.url, score, fromBacklog: true });
            await PriorityQueue.deleteOne({ myHandle: handle, contestId: p.contestId, index: p.index });
        }

        // Apply friend bonus to AI candidates too
        for (const p of allCandidates) {
            p.score += (friendSolveCountMap[p.key] || 0) * 5;
        }

        const merged = [...allCandidates, ...backlogCandidates];
        merged.sort((a, b) => b.score - a.score);

        for (let i = 0; i < merged.length; i++) {
            const p = merged[i];
            await PriorityQueue.create({
                myHandle: handle,
                contestId: p.contestId,
                index: p.index,
                name: p.name,
                rating: p.rating,
                tags: p.tags,
                topic: p.primaryTopic,
                priority: i + 1,
                url: p.url || `https://codeforces.com/problemset/problem/${p.contestId}/${p.index}`,
                done: false,
                fromBacklog: p.fromBacklog || false,
            });
        }

        const savedCount = await PriorityQueue.countDocuments({ myHandle: handle });
        console.log(`[Analyze] Saved ${savedCount} real CF problems to priority queue.`);

        // console.log(days);

        res.json({
            success: true,
            submissionsAnalyzed: recent.length,
            weakTopics: analysis.weakTopics,
            summary: analysis.summary,
            priorityQueueSize: savedCount,
            lastAnalysisDays: days,
            topProblems: allCandidates.slice(0, 10),
        });

    } catch (err) {
        console.error("[Analyze] Error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ─── ROUTE 4: POST /api/plan ──────────────────────────────────────────────────
// Generate a Y-day plan from the priority queue
app.post("/api/plan", requireAuth, async (req, res) => {
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

        // Build friendSolveCount lookup from Backlog collection
        const backlogDocs = await Backlog.find({ myHandle: handle });
        const friendSolveCountMap = {};
        for (const doc of backlogDocs) {
            friendSolveCountMap[`${doc.contestId}-${doc.index}`] = doc.friendSolveCount || 0;
        }

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
                    friendSolveCount: friendSolveCountMap[`${p.contestId}-${p.index}`] || 0,
                    score: p.score || 0,
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
app.get("/api/today", requireAuth, async (req, res) => {
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
app.post("/api/complete", requireAuth, async (req, res) => {
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
app.post("/api/verify", requireAuth, async (req, res) => {
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
app.post("/api/queue/add", requireAuth, async (req, res) => {
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
app.get("/api/profile", requireAuth, async (req, res) => {
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
    problem: todoSchema,
    day: Number,
    updatedAt: { type: Date, default: Date.now },
});
const ProgressState = mongoose.model("ProgressState", progressStateSchema);

app.post("/api/progress/save", requireAuth, async (req, res) => {
    const { handle, key, state, problem, day } = req.body;
    if (!handle || !key || !state || !problem || !day) return res.status(400).json({ error: "handle, key, state, problem, day required." });
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
    const { handle } = req.query;
    if (!handle) return res.status(400).json({ error: "handle required." });
    try {
        const states = await ProgressState.find({ myHandle: handle });
        const map = {};
        for (const s of states) { map[s.key] = { key: s.key, state: s.state, problem: s.problem, day: s.day } };
        res.json({ success: true, states: map });
    } catch (err) { res.status(500).json({ error: err.message }); }
});


// ─── ROUTE: POST /api/uncomplete ─────────────────────────────────────────────
app.post("/api/uncomplete", requireAuth, async (req, res) => {
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

// GET /api/queue/added?handle=X — returns all problem keys in priority queue
app.get("/api/queue/added", requireAuth, async (req, res) => {
    const { handle } = req.query;
    if (!handle) return res.status(400).json({ error: "handle required." });
    try {
        const queue = await PriorityQueue.find({ myHandle: handle });
        const keys = queue.map(p => `${p.contestId}-${p.index}`);
        res.json({ success: true, keys });
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