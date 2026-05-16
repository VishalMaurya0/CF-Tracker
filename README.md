CF Tracker

CF Tracker is a smart Codeforces practice assistant + AI coach that:

Analyzes your submissions
Detects weak topics using AI
Builds a personalized backlog
Generates a structured daily practice plan
Tracks your progress like a learning system

👉 Live App: https://cf-tracker-one-tau.vercel.app/

✨ Features
🧠 AI-Based Analysis
Uses Groq (LLaMA 3.3 70B)
Finds weak topics from real submission data
Gives coaching-style summary
📊 Smart Backlog Engine
Pulls problems solved by friends
Ranks by:
Friend solve count
Rating closeness
Attempt history
📅 Daily Practice Planner

🔄 Real-Time Codeforces Sync

🔐 Secure Auth System

📈 Progress Tracking


🏗️ Tech Stack
Layer	Technology
Backend	Node.js, Express
Database	MongoDB + Mongoose
Auth	JWT + bcrypt
AI	Groq SDK (LLaMA 3.3 70B)
External API	Codeforces API
Deployment	Vercel (Frontend)


🔐 Environment Variables

Create .env file:

PORT=3000
MONGO_URI=your_mongodb_uri
JWT_SECRET=your_secret_key
GROQ_API_KEY=your_groq_api_key
FRONTEND_URL=https://your-frontend-url
🚀 Run Locally
git clone https://github.com/your-username/cf-tracker
cd cf-tracker
npm install
npm start
