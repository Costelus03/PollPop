// ============================================================
// Small, standalone widget for the About page: a one-time vote asking
// if people want more than one poll per day. Completely separate from
// the daily poll logic in script.js - its own tiny Firestore document,
// its own localStorage key.
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  increment
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

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

// A single, fixed document - not one per day like the polls collection
const voteRef = doc(db, "FeatureVotes", "multiple-polls-per-day");
const STORAGE_KEY = "feature_vote_multiple_polls";

const buttonEl = document.getElementById('feature-vote-button');
const thanksEl = document.getElementById('feature-vote-thanks');
const countEl = document.getElementById('feature-vote-count');

// Shows the current tally, e.g. "3 people want this so far"
async function loadCount() {
  try {
    const snapshot = await getDoc(voteRef);
    const count = snapshot.exists() ? snapshot.data().votes : 0;
    countEl.textContent = count === 1
      ? '1 person wants this so far'
      : `${count} people want this so far`;
  } catch (error) {
    console.error('Could not load the feature vote count:', error);
    countEl.textContent = '';
  }
}

async function castVote() {
  buttonEl.disabled = true;

  try {
    // setDoc with { merge: true } creates the document automatically on
    // the very first-ever vote (nothing to set up manually in Firestore
    // beforehand), and safely adds +1 on every vote after that.
    await setDoc(voteRef, { votes: increment(1) }, { merge: true });

    localStorage.setItem(STORAGE_KEY, 'true');
    showThanks();
    loadCount(); // refresh the tally to include this vote

  } catch (error) {
    console.error('Could not save your vote:', error);
    alert('Something went wrong - please try again.');
    buttonEl.disabled = false;
  }
}

function showThanks() {
  buttonEl.classList.add('hidden');
  thanksEl.classList.remove('hidden');
}

function init() {
  loadCount();

  if (localStorage.getItem(STORAGE_KEY)) {
    // Already voted before - skip straight to the thank-you state
    showThanks();
  } else {
    buttonEl.addEventListener('click', castVote);
  }
}

init();
