// ==========================
// FIREBASE IMPORTS
// ==========================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getStorage,
  ref,
  uploadBytes,
  connectStorageEmulator
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import {
  getFunctions,
  httpsCallable,
  connectFunctionsEmulator
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Import the secret config
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);

const storage = getStorage(app);
const functions = getFunctions(app);

// Use "localhost" to match the browser URL
connectStorageEmulator(storage, "localhost", 9199);
connectFunctionsEmulator(functions, "localhost", 5001);

// Callable function reference (THIS IS THE ONLY WAY)
const analyzeSyllabus = httpsCallable(functions, "analyze_syllabus");

// ==========================
// GLOBAL STATE
// ==========================
let uploadedFile = null;
let daysUntilExam = null;
let totalHours = 0;
let remainingHours = 0;

// ==========================
// DOM REFERENCES
// ==========================
const uploadZone = document.getElementById("uploadZone");
const fileInput = document.getElementById("fileInput");
const uploadContent = document.getElementById("uploadContent");
const examDateInput = document.getElementById("examDate");
const daysCounter = document.getElementById("daysCounter");
const daysText = document.getElementById("daysText");
const errorAlert = document.getElementById("errorAlert");
const errorText = document.getElementById("errorText");
const generateBtn = document.getElementById("generateBtn");
const btnText = document.getElementById("btnText");
const resultsCard = document.getElementById("resultsCard");
const studyTableBody = document.getElementById("studyTableBody");
const urgencyContainer = document.getElementById("urgencyContainer");
const tabsContainer = document.getElementById("tabsContainer");
const dayView = document.getElementById("dayView");

// SIDEBAR STATE
function setSidebarActive(label) {
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.textContent.trim() === label);
  });
}

// FILE UPLOAD
uploadZone.addEventListener("click", () => fileInput.click());

uploadZone.addEventListener("dragover", e => {
  e.preventDefault();
  uploadZone.classList.add("drag-active");
});

uploadZone.addEventListener("dragleave", () => {
  uploadZone.classList.remove("drag-active");
});

uploadZone.addEventListener("drop", e => {
  e.preventDefault();
  uploadZone.classList.remove("drag-active");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

fileInput.addEventListener("change", e => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

function handleFile(file) {
  hideError();

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    showError("Please upload a PDF file");
    return;
  }

  uploadedFile = file;
  uploadZone.classList.add("file-uploaded");

  uploadContent.innerHTML = `
    <div class="upload-icon"><i class="fas fa-check-circle"></i></div>
    <div class="file-name">${file.name}</div>
    <div class="upload-subtext">Click to change file</div>
  `;
}

// ==========================
// DATE PICKER
// ==========================
examDateInput.min = new Date().toISOString().split("T")[0];

examDateInput.addEventListener("change", e => {
  hideError();

  const today = new Date();
  const exam = new Date(e.target.value);
  today.setHours(0, 0, 0, 0);
  exam.setHours(0, 0, 0, 0);

  const diff = Math.ceil((exam - today) / 86400000);

  if (diff <= 0) {
    daysUntilExam = null;
    daysCounter.style.display = "none";
    showError("Select a future exam date");
  } else {
    daysUntilExam = diff;
    daysText.textContent = `${diff} days until exam`;
    daysCounter.style.display = "flex";
  }
});

// ==========================
// GENERATE BUTTON
// ==========================
generateBtn.addEventListener("click", async () => {
  if (!uploadedFile) return showError("Upload syllabus PDF");
  if (!daysUntilExam) return showError("Select exam date");

  await generatePlan();
});

// ==========================
// CORE FLOW (CORRECT)
// ==========================
async function generatePlan() {
  hideError();
  setLoading(true);
  setSidebarActive("Dashboard");

  try {
    // 1. Upload PDF to Firebase Storage
    const storageRef = ref(storage, `syllabi/${uploadedFile.name}`);
    const snap = await uploadBytes(storageRef, uploadedFile);

    // 2. Call callable Cloud Function (NO FETCH)
    const result = await analyzeSyllabus({
      filePath: snap.metadata.fullPath,
      days: daysUntilExam
    });

    // 3. Render result
    renderResults(result.data.plan);

    // SAVE FOR QUIZ
    localStorage.setItem("currentSyllabusPath", snap.metadata.fullPath);
    console.log("Saved syllabus path for quiz:", snap.metadata.fullPath);

  } catch (err) {
    console.error(err);
    showError("Failed to generate study plan");
  } finally {
    setLoading(false);
  }
}

// ==========================
// RENDER RESULTS
// ==========================
function renderResults(plan) {
  studyTableBody.innerHTML = "";
  urgencyContainer.innerHTML = "";
  tabsContainer.innerHTML = "";
  dayView.innerHTML = "";
  dayView.style.display = "none";

  totalHours = plan.reduce((s, t) => s + Number(t.hours), 0);
  remainingHours = totalHours;

  renderUrgency();
  renderTabs(plan);

  plan.forEach(topic => {
    const row = document.createElement("tr");

    // Determine difficulty class (easy, medium, hard)
    const diff = (topic.difficulty || '').toString().toLowerCase();
    const diffClass = diff === 'easy' ? 'easy' : diff === 'hard' ? 'hard' : 'medium';

    // Determine if topic is mandatory: either explicit `necessary` flag or High priority
    // Note: not adding a full-row background highlight per user request
    const mandatory = topic.necessary === true || (topic.priority && topic.priority.toString().toLowerCase() === 'high');

    const priorityBadgeClass = topic.priority && topic.priority.toString().toLowerCase() === 'high' ? 'badge-high-priority' : (topic.priority && topic.priority.toString().toLowerCase() === 'medium' ? 'badge-medium-priority' : 'badge-medium-priority');

    row.innerHTML = `
      <td><input type="checkbox" class="topic-done" data-hours="${topic.hours}"></td>
      <td class="topic-name">${topic.name}</td>
      <td><span class="badge ${priorityBadgeClass}">${topic.priority}</span></td>
      <td><span class="badge badge-${diffClass}">${topic.difficulty}</span></td>
      <td class="hours">${topic.hours} hours</td>
    `;

    // Add visual styling for must-do topics
    if (mandatory) {
      row.classList.add('must-do');
      row.querySelector('.topic-name').style.fontWeight = 'bold';
    }

    studyTableBody.appendChild(row);
  });

  resultsCard.classList.add("show");
  setSidebarActive("My Schedule");
}

// ==========================
// URGENCY + PROGRESS
// ==========================
function renderUrgency() {
  const perDay = (remainingHours / daysUntilExam).toFixed(1);

  urgencyContainer.innerHTML = `
    <div class="time-urgency">
      <div class="days-big">
        <div class="num">${daysUntilExam}</div>
        <div class="label">days left</div>
      </div>
      <div class="timeline">
        <div>Workload: ${remainingHours} hrs — est ${perDay} hrs/day</div>
        <div class="day-boxes">
          ${Array.from({ length: Math.min(daysUntilExam, 30) })
      .map(() => `<div class="day-box ${perDay > 6 ? 'red' : perDay > 4 ? 'yellow' : 'green'}"></div>`).join("")}
        </div>
      </div>
    </div>
  `;


}

// ==========================
// TABS
// ==========================
function renderTabs(plan) {
  const tabs = ["Overview", "By Day", "Topics"];
  tabs.forEach((t, i) => {
    const tab = document.createElement("div");
    tab.className = `tab ${i === 0 ? 'active' : ''}`;
    tab.textContent = t;
    tab.onclick = () => switchTab(t, plan);
    tabsContainer.appendChild(tab);
  });
}

function switchTab(tab, plan) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.textContent === tab));

  if (tab === "By Day") {
    document.querySelector(".study-table").style.display = "none";
    renderByDay(plan);
  } else {
    dayView.style.display = "none";
    document.querySelector(".study-table").style.display = "table";
  }
}

function renderByDay(plan) {
  dayView.style.display = "block";
  dayView.innerHTML = "";
  const perDay = totalHours / daysUntilExam;

  let day = 1, acc = 0;
  const list = document.createElement("div"); list.className = "day-list";

  plan.forEach(t => {
    if (acc + t.hours > perDay) { day++; acc = 0; }
    acc += t.hours;
    const d = document.createElement("div");
    d.className = "day-card";
    d.innerHTML = `<h4>Day ${day}</h4><div>${t.name} — ${t.hours} hrs</div>`;
    list.appendChild(d);
  });

  dayView.appendChild(list);
}

// ==========================
// CHECKBOX HANDLING
// ==========================
studyTableBody.addEventListener("change", e => {
  if (!e.target.classList.contains("topic-done")) return;
  const h = Number(e.target.dataset.hours);
  remainingHours += e.target.checked ? -h : h;
  e.target.closest("tr").classList.toggle("completed", e.target.checked);
  renderUrgency();
});

// ==========================
// UI HELPERS
// ==========================
function setLoading(v) {
  generateBtn.disabled = v;
  btnText.innerHTML = v
    ? `<div class="loader"></div><span>Analyzing...</span>`
    : "Generate Schedule";
}

function showError(msg) {
  errorText.textContent = msg;
  errorAlert.classList.add("show");
}

function hideError() {
  errorAlert.classList.remove("show");
}
