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

// ==========================
// FIREBASE CONFIG (USE YOUR REAL ONE)
// ==========================
const firebaseConfig = {
  apiKey: "AIzaSyBtycxDl7viHVyA85iwpIYiLMKW5A7ke_I",
  authDomain: "study-sprint-64688.firebaseapp.com",
  projectId: "study-sprint-64688",
  storageBucket: "study-sprint-64688.appspot.com",
  appId: "1:702325091259:web:7a0f0b5c7d1e2f3a4b5c6d"
};

// ==========================
// INIT FIREBASE + EMULATORS
// ==========================
const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
const functions = getFunctions(app);

// Local dev (avoids CORS)
connectStorageEmulator(storage, "127.0.0.1", 9199);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

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

// ==========================
// SIDEBAR STATE
// ==========================
function setSidebarActive(label) {
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.textContent.trim() === label);
  });
}

// ==========================
// FILE UPLOAD
// ==========================
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
  today.setHours(0,0,0,0);
  exam.setHours(0,0,0,0);

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
// CORE FLOW
// ==========================
async function generatePlan() {
  hideError();
  setLoading(true);
  setSidebarActive("Dashboard");

  try {
    const storageRef = ref(storage, `syllabi/${uploadedFile.name}`);
    const snap = await uploadBytes(storageRef, uploadedFile);

    // Call the local HTTP wrapper (has CORS headers) on the Functions emulator
    const fnUrl = `http://127.0.0.1:5001/${firebaseConfig.projectId}/us-central1/analyze_syllabus_http`;
    const resp = await fetch(fnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: snap.metadata.fullPath, days: daysUntilExam })
    });

    if (!resp.ok) {
      const err = await resp.json().catch(()=>({error:'unknown'}));
      throw new Error('Function error: ' + (err.error || resp.statusText));
    }

    const data = await resp.json();
    renderResults(data.plan);

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

  totalHours = plan.reduce((s,t)=>s+Number(t.hours),0);
  remainingHours = totalHours;

  renderUrgency(plan);
  renderTabs(plan);

  plan.forEach(topic => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" class="topic-done" data-hours="${topic.hours}"></td>
      <td class="topic-name">${topic.name}</td>
      <td><span class="badge badge-medium-priority">${topic.priority}</span></td>
      <td><span class="badge badge-medium">${topic.difficulty}</span></td>
      <td class="hours">${topic.hours} hours</td>
    `;
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
          ${Array.from({length: Math.min(daysUntilExam,30)})
            .map(()=>`<div class="day-box ${perDay>6?'red':perDay>4?'yellow':'green'}"></div>`).join("")}
        </div>
      </div>
    </div>
  `;
}

// ==========================
// TABS
// ==========================
function renderTabs(plan) {
  const tabs = ["Overview","By Day","Topics"];
  tabs.forEach((t,i)=>{
    const tab = document.createElement("div");
    tab.className = `tab ${i===0?'active':''}`;
    tab.textContent = t;
    tab.onclick = ()=>switchTab(t, plan);
    tabsContainer.appendChild(tab);
  });
}

function switchTab(tab, plan) {
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active",t.textContent===tab));

  if (tab==="By Day") {
    document.querySelector(".study-table").style.display="none";
    renderByDay(plan);
  } else {
    dayView.style.display="none";
    document.querySelector(".study-table").style.display="table";
  }
}

function renderByDay(plan) {
  dayView.style.display="block";
  dayView.innerHTML="";
  const perDay = totalHours / daysUntilExam;

  let day=1, acc=0;
  const list=document.createElement("div"); list.className="day-list";

  plan.forEach(t=>{
    if(acc+t.hours>perDay){ day++; acc=0; }
    acc+=t.hours;
    const d=document.createElement("div");
    d.className="day-card";
    d.innerHTML=`<h4>Day ${day}</h4><div>${t.name} — ${t.hours} hrs</div>`;
    list.appendChild(d);
  });

  dayView.appendChild(list);
}

// ==========================
// CHECKBOX HANDLING
// ==========================
studyTableBody.addEventListener("change", e=>{
  if(!e.target.classList.contains("topic-done")) return;
  const h=Number(e.target.dataset.hours);
  remainingHours += e.target.checked ? -h : h;
  e.target.closest("tr").classList.toggle("completed", e.target.checked);
  renderUrgency();
});

// ==========================
// UI HELPERS
// ==========================
function setLoading(v){
  generateBtn.disabled=v;
  btnText.innerHTML=v?`<div class="loader"></div><span>Analyzing...</span>`:"Generate Schedule";
}

function showError(msg){
  errorText.textContent=msg;
  errorAlert.classList.add("show");
}

function hideError(){
  errorAlert.classList.remove("show");
}
