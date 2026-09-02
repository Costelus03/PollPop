// ============================================================
// STEP 1: Load Firebase from the CDN (v10, modular SDK)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  limit,
  documentId,
  updateDoc,
  increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

// ============================================================
// STEP 2: Your Firebase project configuration
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyBZ8-wpZ12KhF96Qjm3WshuGE4jiAm8Jt4",
  authDomain: "pollpop-79940.firebaseapp.com",
  projectId: "pollpop-79940",
  storageBucket: "pollpop-79940.firebasestorage.app",
  messagingSenderId: "58765865318",
  appId: "1:58765865318:web:c19a04ba96c46e4eab58a7",
  measurementId: "G-WLYK0GEDQE"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// The collection that holds one document per day
const POLLS_COLLECTION = "Polls";

// The field in each document that holds the question text
const QUESTION_FIELD = "question";

// How many past polls to show in the archive list
const ARCHIVE_SIZE = 14;

// ============================================================
// STEP 3: Keep track of which poll is currently on screen
// ============================================================
// This changes when the user opens an old poll from the archive,
// so handleVote() always knows which document to update.
let currentPollId = null;

// ============================================================
// STEP 4: Grab the HTML elements we need to update
// ============================================================
const questionEl = document.getElementById('question');
const dateLabelEl = document.getElementById('poll-date-label');
const backToTodayBtn = document.getElementById('back-to-today');
const optionsContainer = document.getElementById('options-container');
const resultsContainer = document.getElementById('results');
const resultsList = document.getElementById('results-list');
const totalVotesText = document.getElementById('total-votes');

const archiveBtn = document.getElementById('archive-btn');
const archiveModal = document.getElementById('archive-modal');
const archiveList = document.getElementById('archive-list');
const closeArchiveBtn = document.getElementById('close-archive');
const archiveDateInput = document.getElementById('archive-date-input');
const archiveDateGoBtn = document.getElementById('archive-date-go');
const archiveDateError = document.getElementById('archive-date-error');

// ============================================================
// STEP 5: Date helpers
// ============================================================
// Builds today's id in the exact "YYYY-MM-DD" format used as document IDs.
// (We build it manually instead of toISOString() because toISOString()
// uses UTC time, which can show "yesterday" or "tomorrow" depending on
// the user's timezone. This version uses the browser's local date.)
function getTodayId() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Turns "2026-08-25" into something readable, like "August 25, 2026"
function formatDateForDisplay(pollId) {
  // "T00:00:00" makes JS read it as local midnight, avoiding a day shift
  const dateObj = new Date(pollId + 'T00:00:00');
  return dateObj.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Every localStorage key is namespaced by the poll's own id (the date),
// so voting on one day never affects any other day.
function getStorageKey(pollId) {
  return 'poll_user_choice_' + pollId;
}

// ============================================================
// STEP 6: Firestore helpers
// ============================================================
// Fetches ONE poll document by its id (the date string)
async function fetchPollData(pollId) {
  const pollRef = doc(db, POLLS_COLLECTION, pollId);
  const snapshot = await getDoc(pollRef);

  if (!snapshot.exists()) {
    throw new Error(`Poll "${pollId}" was not found in Firestore.`);
  }

  return snapshot.data();
}

// Splits a document's data into { question, options }.
// Every field EXCEPT "question" is treated as an answer option with a
// vote count - so adding a new option in Firestore needs no code changes.
function splitQuestionAndOptions(data) {
  const question = data[QUESTION_FIELD];
  const options = {};

  Object.keys(data).forEach((fieldName) => {
    if (fieldName !== QUESTION_FIELD) {
      options[fieldName] = data[fieldName];
    }
  });

  return { question, options };
}

// Fetches a list of past poll ids + questions, newest first, skipping
// today's poll (that one is already shown on the main screen).
// Document ids look like "2026-08-25", so sorting them as text also
// sorts them chronologically - no extra date field needed.
async function fetchArchivePolls(todayId) {
  const pollsRef = collection(db, POLLS_COLLECTION);
  const archiveQuery = query(
    pollsRef,
    orderBy(documentId(), 'desc'),
    limit(ARCHIVE_SIZE + 1) // +1 in case today's doc is included in the batch
  );

  const snapshot = await getDocs(archiveQuery);
  const archive = [];

  snapshot.forEach((docSnap) => {
    if (docSnap.id !== todayId) {
      archive.push({
        id: docSnap.id,
        question: docSnap.data()[QUESTION_FIELD]
      });
    }
  });

  return archive.slice(0, ARCHIVE_SIZE);
}

// ============================================================
// STEP 7: Render the question + date label
// ============================================================
function renderPollHeader(pollId, question) {
  questionEl.textContent = question;

  if (pollId === getTodayId()) {
    dateLabelEl.textContent = "Today's poll";
    backToTodayBtn.classList.add('hidden');
  } else {
    dateLabelEl.textContent = 'Poll from ' + formatDateForDisplay(pollId);
    backToTodayBtn.classList.remove('hidden');
  }
}

// ============================================================
// STEP 8: Build one button per option (voting screen)
// ============================================================
function renderVotingButtons(options) {
  const sortedNames = Object.keys(options).sort((a, b) => a.localeCompare(b));

  optionsContainer.innerHTML = '';
  optionsContainer.classList.remove('hidden');
  resultsContainer.classList.add('hidden');

  sortedNames.forEach((optionName) => {
    const button = document.createElement('button');
    button.className = 'option-btn';
    button.textContent = optionName;
    button.addEventListener('click', () => handleVote(optionName));
    optionsContainer.appendChild(button);
  });
}

// ============================================================
// STEP 9: Draw the result bars (results screen)
// ============================================================
function renderResults(options) {
  const total = Object.values(options).reduce((sum, count) => sum + count, 0);
  const sortedNames = Object.keys(options).sort((a, b) => a.localeCompare(b));

  resultsList.innerHTML = '';

  sortedNames.forEach((optionName) => {
    const count = options[optionName];
    const percent = total === 0 ? 0 : Math.round((count / total) * 100);

    const row = document.createElement('div');
    row.className = 'result-row';

    const label = document.createElement('span');
    label.className = 'result-label';
    label.textContent = optionName;

    const barTrack = document.createElement('div');
    barTrack.className = 'bar-track';

    const barFill = document.createElement('div');
    barFill.className = 'bar-fill';
    barFill.style.width = percent + '%';

    const percentLabel = document.createElement('span');
    percentLabel.className = 'result-percent';
    percentLabel.textContent = count;

    barTrack.appendChild(barFill);
    row.appendChild(label);
    row.appendChild(barTrack);
    row.appendChild(percentLabel);
    resultsList.appendChild(row);
  });

  totalVotesText.textContent = 'Total votes: ' + total;

  optionsContainer.classList.add('hidden');
  resultsContainer.classList.remove('hidden');
}

// ============================================================
// STEP 10: Load ANY poll by id - used for today's poll AND for
// every poll opened from the archive
// ============================================================
// The second argument is only used internally by loadMostRecentPoll()
// below, to avoid an infinite loop if there's no poll at all yet.
async function loadPoll(pollId, isFallbackAttempt = false) {
  currentPollId = pollId;
  questionEl.textContent = 'Loading poll…';
  dateLabelEl.textContent = '';

  try {
    const data = await fetchPollData(pollId);
    const { question, options } = splitQuestionAndOptions(data);

    renderPollHeader(pollId, question);

    const alreadyVoted = localStorage.getItem(getStorageKey(pollId));
    if (alreadyVoted) {
      renderResults(options);
    } else {
      renderVotingButtons(options);
    }

  } catch (error) {
    // If today's document simply hasn't been created yet (e.g. you forgot
    // to add it), don't show a broken page - fall back to the most
    // recent poll that DOES exist instead.
    if (pollId === getTodayId() && !isFallbackAttempt) {
      console.warn(`Today's poll ("${pollId}") isn't available yet - loading the most recent one instead.`);
      await loadMostRecentPoll();
      return;
    }

    console.error('Could not load the poll:', error);
    questionEl.textContent = 'Could not load this poll. Please try again.';
  }
}

// Finds and loads the newest poll that exists in Firestore, used only
// as a safety net when today's poll isn't ready yet.
async function loadMostRecentPoll() {
  try {
    const pastPolls = await fetchArchivePolls(getTodayId());

    if (pastPolls.length === 0) {
      // There's truly no poll in the whole database yet
      questionEl.textContent = 'No poll is available yet. Please check back soon!';
      dateLabelEl.textContent = '';
      return;
    }

    // fetchArchivePolls() already sorts newest-first, so index 0 is the latest
    const mostRecentId = pastPolls[0].id;
    await loadPoll(mostRecentId, true); // true = "this IS the fallback attempt"

    // Override the normal date label with a clearer explanation,
    // and hide "back to today" since today's poll doesn't exist yet
    dateLabelEl.textContent = "Today's poll isn't ready yet — showing " + formatDateForDisplay(mostRecentId);
    backToTodayBtn.classList.add('hidden');

  } catch (error) {
    console.error('Could not load a fallback poll:', error);
    questionEl.textContent = 'No poll is available right now. Please check back soon!';
  }
}

// ============================================================
// STEP 11: Handle a vote click
// ============================================================
async function handleVote(optionName) {
  const allButtons = optionsContainer.querySelectorAll('.option-btn');
  allButtons.forEach((btn) => (btn.disabled = true));

  const pollRef = doc(db, POLLS_COLLECTION, currentPollId);

  // ---- Step 1: actually save the vote ----
  // If THIS fails, nothing was recorded on the server, so it's safe
  // to let the user try again.
  try {
    // increment(1) adds +1 safely on the server, even with many
    // simultaneous voters, since we never read-then-overwrite a value.
    await updateDoc(pollRef, { [optionName]: increment(1) });
  } catch (error) {
    console.error('Could not save the vote:', error);
    alert('Something went wrong while saving your vote. Please try again.');
    allButtons.forEach((btn) => (btn.disabled = false));
    return; // stop here - the vote was NOT recorded, nothing else to do
  }

  // The vote is now safely saved on the server. Lock it in locally too,
  // right away, so this browser can never end up voting twice on this
  // poll - even if something below fails.
  localStorage.setItem(getStorageKey(currentPollId), optionName);

  // ---- Step 2: refresh the on-screen numbers ----
  // If THIS fails, the vote itself is still safely saved - we just
  // couldn't fetch the latest totals to display. That's not worth
  // scaring the user with an error over.
  try {
    const data = await fetchPollData(currentPollId);
    const { options } = splitQuestionAndOptions(data);
    renderResults(options);
  } catch (error) {
    console.error('Vote saved, but could not refresh results:', error);
    optionsContainer.classList.add('hidden');
    resultsList.innerHTML = '';
    resultsContainer.classList.remove('hidden');
    totalVotesText.textContent = 'Your vote was saved! Refresh the page to see full results.';
  }
}

// ============================================================
// STEP 12: Archive modal (open / close / render list / pick a poll)
// ============================================================
async function openArchive() {
  archiveModal.classList.remove('hidden');
  archiveList.innerHTML = '<p class="archive-empty">Loading…</p>';
  archiveDateError.textContent = '';
  archiveDateInput.max = getTodayId(); // can't pick a future date - no poll exists yet

  try {
    const pastPolls = await fetchArchivePolls(getTodayId());
    renderArchiveList(pastPolls);
  } catch (error) {
    console.error('Could not load past polls:', error);
    archiveList.innerHTML = '<p class="archive-empty">Could not load past polls.</p>';
  }
}

function closeArchive() {
  archiveModal.classList.add('hidden');
}

function renderArchiveList(pastPolls) {
  archiveList.innerHTML = '';

  if (pastPolls.length === 0) {
    archiveList.innerHTML = '<p class="archive-empty">No past polls yet.</p>';
    return;
  }

  pastPolls.forEach((poll) => {
    const item = document.createElement('button');
    item.className = 'archive-item';
    item.type = 'button';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'archive-date';
    dateSpan.textContent = formatDateForDisplay(poll.id);

    const questionSpan = document.createElement('span');
    questionSpan.className = 'archive-question';
    questionSpan.textContent = poll.question;

    item.appendChild(dateSpan);
    item.appendChild(questionSpan);

    // Clicking a past poll closes the modal and loads that day's poll
    item.addEventListener('click', () => {
      closeArchive();
      loadPoll(poll.id);
    });

    archiveList.appendChild(item);
  });
}

// Loads whatever poll the user picked from the date input.
// Unlike clicking an archive list item, we don't know in advance
// whether that date has a poll - so we check first, and show a
// friendly inline message instead of navigating away if it doesn't.
async function goToPollByDate() {
  const chosenDate = archiveDateInput.value; // native <input type="date"> gives "YYYY-MM-DD" directly
  archiveDateError.textContent = '';

  if (!chosenDate) {
    archiveDateError.textContent = 'Pick a date first.';
    return;
  }

  archiveDateGoBtn.disabled = true;

  try {
    await fetchPollData(chosenDate); // just checking it exists
    closeArchive();
    loadPoll(chosenDate);
  } catch (error) {
    archiveDateError.textContent = 'No poll exists for that date yet.';
  } finally {
    archiveDateGoBtn.disabled = false;
  }
}

// ============================================================
// STEP 13: Wire up all the buttons
// ============================================================
archiveBtn.addEventListener('click', openArchive);
closeArchiveBtn.addEventListener('click', closeArchive);
archiveDateGoBtn.addEventListener('click', goToPollByDate);

// Clicking the dark overlay outside the modal panel also closes it
archiveModal.addEventListener('click', (event) => {
  if (event.target === archiveModal) {
    closeArchive();
  }
});

backToTodayBtn.addEventListener('click', () => loadPoll(getTodayId()));

// ============================================================
// STEP 15: Cookie consent banner
// ============================================================
// This section is independent from the poll logic above - it just
// remembers whether the user accepted or declined cookies, and tells
// Google Consent Mode (set up in index.html's <head>) about that choice.
const CONSENT_STORAGE_KEY = 'cookie_consent'; // will hold 'granted' or 'denied'

const cookieBanner = document.getElementById('cookie-banner');
const cookieAcceptBtn = document.getElementById('cookie-accept');
const cookieDeclineBtn = document.getElementById('cookie-decline');
const cookieSettingsLink = document.getElementById('cookie-settings-link');

// Applies the user's choice to Google Consent Mode and hides the banner.
// status is either 'granted' or 'denied'.
function applyConsent(status) {
  localStorage.setItem(CONSENT_STORAGE_KEY, status);

  // gtag() was defined in index.html's <head>. Calling it again here,
  // with 'update' instead of 'default', changes the actual permissions.
  //
  // We guard this call: some privacy/ad-blocker extensions strip out
  // scripts that look like Google tracking code, which would make
  // "gtag" undefined here. Without this check, that would throw an
  // error and stop the function BEFORE the banner gets hidden below -
  // trapping the user with a banner that never goes away.
  if (typeof gtag === 'function') {
    gtag('consent', 'update', {
      'ad_storage': status,
      'ad_user_data': status,
      'ad_personalization': status,
      'analytics_storage': status
    });
  }

  // This always runs, even if gtag was missing above
  cookieBanner.classList.add('hidden');
}

// Runs once when the page loads
function initCookieBanner() {
  const savedChoice = localStorage.getItem(CONSENT_STORAGE_KEY);

  if (savedChoice) {
    // The user already chose before - just re-apply that choice
    // (Consent Mode resets to "denied" on every page load otherwise)
    applyConsent(savedChoice);
  } else {
    // First visit - show the banner and wait for a click
    cookieBanner.classList.remove('hidden');
  }
}

cookieAcceptBtn.addEventListener('click', () => applyConsent('granted'));
cookieDeclineBtn.addEventListener('click', () => applyConsent('denied'));

// Lets the user reopen the banner later, e.g. to change their mind
cookieSettingsLink.addEventListener('click', () => {
  cookieBanner.classList.remove('hidden');
});

initCookieBanner();

// ============================================================
// STEP 16: Run this when the page first loads - loads today's poll
// ============================================================
loadPoll(getTodayId());