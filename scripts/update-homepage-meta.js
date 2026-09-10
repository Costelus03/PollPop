// ============================================================
// Updates index.html's <title> and <meta description> to reflect
// TODAY's actual poll question, so Google (and link previews on
// WhatsApp/Facebook) see real content instead of "Loading poll…" -
// the page normally only fills that in with JavaScript, after the
// browser fetches data from Firestore, which crawlers don't always
// wait around for.
//
// Runs once a day, right before the site gets redeployed - see
// .github/workflows/daily-poll.yml in this same repository.
// ============================================================
const fs = require('fs');
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const POLLS_COLLECTION = 'Polls';
const INDEX_FILE = 'index.html';

// Same "YYYY-MM-DD" format used as document IDs, in UTC (this script
// runs on GitHub's servers, always UTC, regardless of where you are)
function getTodayId() {
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = String(today.getUTCMonth() + 1).padStart(2, '0');
  const day = String(today.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Prevents today's question text from accidentally breaking the HTML
// if it ever contains characters like < > " &
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function main() {
  const todayId = getTodayId();
  const pollRef = db.collection(POLLS_COLLECTION).doc(todayId);
  const snapshot = await pollRef.get();

  if (!snapshot.exists) {
    console.log(`No poll found for ${todayId} yet - leaving index.html's title/description unchanged.`);
    return;
  }

  const question = snapshot.data().question;
  if (!question) {
    console.log("Today's poll document has no \"question\" field - leaving index.html unchanged.");
    return;
  }

  let html = fs.readFileSync(INDEX_FILE, 'utf8');

  const newTitle = `${question} — Daily Poll`;
  const newDescription = `Today's question: "${question}" Vote and see what everyone else picked. A new poll every day.`;

  html = html.replace(/<title>.*<\/title>/, `<title>${escapeHtml(newTitle)}</title>`);
  html = html.replace(
    /<meta name="description" content=".*" \/>/,
    `<meta name="description" content="${escapeHtml(newDescription)}" />`
  );

  fs.writeFileSync(INDEX_FILE, html, 'utf8');
  console.log(`Updated index.html for today's poll: "${question}"`);
}

main().catch((error) => {
  console.error('Failed to update homepage meta tags:', error);
  process.exit(1);
});
