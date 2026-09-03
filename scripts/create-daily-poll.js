// ============================================================
// This script creates TOMORROW's poll document in Firestore.
// Instead of picking from a fixed list, it asks Claude (Anthropic's
// AI) to invent a brand-new question every day - so you never have
// to write questions.json by hand.
//
// It's meant to run automatically once a day via GitHub Actions -
// see .github/workflows/daily-poll.yml in the same repository.
// ============================================================
const admin = require('firebase-admin');
const Anthropic = require('@anthropic-ai/sdk');

// The service account key is provided as a GitHub Actions secret
// (as a JSON string in an environment variable) - it is never
// stored inside this file or committed to the repository.
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const POLLS_COLLECTION = 'Polls';

// The Claude API key also comes from a GitHub Actions secret
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Builds tomorrow's date as "YYYY-MM-DD", in UTC.
function getTomorrowId() {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const year = tomorrow.getUTCFullYear();
  const month = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

// Reads every past poll's question text, so we can tell Claude what's
// already been asked and it can avoid repeating itself.
async function fetchPastQuestions() {
  const snapshot = await db.collection(POLLS_COLLECTION).get();
  const questions = [];

  snapshot.forEach((docSnap) => {
    const questionText = docSnap.data().question;
    if (questionText) {
      questions.push(questionText);
    }
  });

  return questions;
}

// Asks Claude to invent a brand-new poll question + answer options.
async function generateNewPoll(pastQuestions) {
  const avoidList = pastQuestions.length > 0
    ? pastQuestions.map((q) => `- ${q}`).join('\n')
    : '(none yet - this is the very first poll)';

  const prompt = `You write daily poll questions for a "curiosity poll" website - similar in spirit to Wordle, but for opinions instead of words. People vote, then see what everyone else picked.

Write ONE brand-new poll question in English. It should be genuinely interesting to answer - the kind of question where you're curious what other people think. Mix up the style over time: personal preferences, "would you rather" dilemmas, light opinions, fun hypotheticals, everyday debates.

Choose the NUMBER of answer options based on what fits the question naturally, not a fixed count:
- For questions with a wide, natural range of choices (favorite fruit, favorite country, favorite movie genre, favorite decade of music, etc.), give a generous list - 8 to 12 options - so people actually find the one they'd pick, not just the 3 most obvious ones.
- For sharper dilemmas or opinion questions ("would you rather...", yes/no-ish debates), 2 to 5 options is usually enough and keeps it punchy.
Always include at least 2 options. Feel free to add one witty/unexpected option where it fits (like a "none of the above" style answer), not just the obvious picks.

Keep the question itself short, punchy, and clear.

Do NOT repeat or closely resemble any of these already-used questions:
${avoidList}

Respond with ONLY valid JSON, no markdown formatting, no extra commentary, in exactly this shape:
{"question": "...", "options": ["...", "...", "..."]}`;

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const rawText = response.content[0].text.trim();

  // Claude sometimes wraps its answer in a markdown code fence
  // (```json ... ```) even when asked not to - strip that off first,
  // so JSON.parse() below doesn't choke on it.
  const cleanedText = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const parsed = JSON.parse(cleanedText);

  if (!parsed.question || !Array.isArray(parsed.options) || parsed.options.length < 2) {
    throw new Error('Claude\'s response was missing a question or valid options: ' + rawText);
  }

  return parsed;
}

async function main() {
  const pollId = getTomorrowId();
  const pollRef = db.collection(POLLS_COLLECTION).doc(pollId);

  // Don't overwrite a poll that already exists (e.g. you added one
  // manually, or this script already ran successfully today)
  const existingDoc = await pollRef.get();
  if (existingDoc.exists) {
    console.log(`A poll for ${pollId} already exists - nothing to do.`);
    return;
  }

  const pastQuestions = await fetchPastQuestions();
  const newPoll = await generateNewPoll(pastQuestions);

  // Build the document: { question: "...", OptionA: 0, OptionB: 0, ... }
  const newPollData = { question: newPoll.question };
  newPoll.options.forEach((optionName) => {
    newPollData[optionName] = 0;
  });

  await pollRef.set(newPollData);
  console.log(`Created poll for ${pollId}: "${newPoll.question}"`);
}

main().catch((error) => {
  console.error('Failed to create the daily poll:', error);
  process.exit(1); // makes the GitHub Actions run show as "failed", so you notice
});