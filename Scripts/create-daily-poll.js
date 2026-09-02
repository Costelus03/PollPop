// ============================================================
// This script creates TOMORROW's poll document in Firestore.
// It's meant to run automatically once a day via GitHub Actions -
// see .github/workflows/daily-poll.yml in the same repository.
//
// It does NOT run in the browser like script.js does - it runs on
// GitHub's servers, using Node.js, with full admin access to Firestore
// (that's why it can create documents even though your Firestore
// security rules block that from the browser).
// ============================================================
const admin = require('firebase-admin');
const questions = require('./questions.json');

// The service account key is provided as a GitHub Actions secret
// (as a JSON string in an environment variable) - it is never
// stored inside this file or committed to the repository.
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const POLLS_COLLECTION = 'Polls';

// Checks the WHOLE questions.json list for repeated question text
// (case-insensitive), so an old question you forgot about - even one
// added 100 days ago - can't accidentally get added a second time
// without you noticing.
function checkForDuplicateQuestions(questionList) {
  const seenQuestions = new Set();
  const duplicates = [];

  questionList.forEach((item) => {
    const normalized = item.question.trim().toLowerCase();
    if (seenQuestions.has(normalized)) {
      duplicates.push(item.question);
    }
    seenQuestions.add(normalized);
  });

  if (duplicates.length > 0) {
    throw new Error(
      'Duplicate question(s) found in questions.json: "' +
      duplicates.join('", "') +
      '". Please remove or edit the duplicate, then push again.'
    );
  }
}

// Builds tomorrow's date as "YYYY-MM-DD", in UTC.
// (GitHub Actions servers always run in UTC, no matter where you are.)
function getTomorrowId() {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const year = tomorrow.getUTCFullYear();
  const month = String(tomorrow.getUTCMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getUTCDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

async function main() {
  // Fail fast, before touching Firestore at all, if the question list
  // itself has a mistake in it.
  checkForDuplicateQuestions(questions);

  const pollId = getTomorrowId();
  const pollRef = db.collection(POLLS_COLLECTION).doc(pollId);

  // Don't overwrite a poll that already exists (e.g. you added one
  // manually, or this script already ran successfully today)
  const existingDoc = await pollRef.get();
  if (existingDoc.exists) {
    console.log(`A poll for ${pollId} already exists - nothing to do.`);
    return;
  }

  // Pick the next question from questions.json, cycling through the
  // list based on how many polls already exist in Firestore - so it
  // works through the whole list once before repeating any question.
  const allPolls = await db.collection(POLLS_COLLECTION).listDocuments();
  const pollCount = allPolls.length;
  const chosenQuestion = questions[pollCount % questions.length];

  // Build the document: { question: "...", OptionA: 0, OptionB: 0, ... }
  const newPollData = { question: chosenQuestion.question };
  chosenQuestion.options.forEach((optionName) => {
    newPollData[optionName] = 0;
  });

  await pollRef.set(newPollData);
  console.log(`Created poll for ${pollId}: "${chosenQuestion.question}"`);
}

main().catch((error) => {
  console.error('Failed to create the daily poll:', error);
  process.exit(1); // makes the GitHub Actions run show as "failed", so you notice
});
