// ==========================
// FIREBASE IMPORTS
// ==========================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFunctions,
    httpsCallable,
    connectFunctionsEmulator
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Import the secret config
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

// Use "localhost" to match the browser URL
connectFunctionsEmulator(functions, "localhost", 5001);

// Callable function reference
const generateQuiz = httpsCallable(functions, "generate_quiz");

// ==========================
// STATE MANAGEMENT
// ==========================
let quizData = [];
let currentQuestionIndex = 0;
let userAnswers = []; // Store selected option indices
let timeLeft = 300; // 5 minutes in seconds
let timerInterval;

// ==========================
// DOM ELEMENTS
// ==========================
// NOTE: We only capture static elements here. Dynamic elements inside main-question-area
// must be queried fresh after every render.
const dom = {
    timeLeft: document.getElementById('timeLeft'),
    score: document.getElementById('score'),

    // These might be replaced, so we should query them dynamically, 
    // but these IDs exist in the initial HTML structure so it's okay initially.
    // However, if we nuke .main-question-area, these are gone.
    mainArea: document.querySelector('.main-question-area'),
    questionGrid: document.getElementById('questionGrid'),
    totalQuestions: document.getElementById('totalQuestions'),

    // Helper to get fresh references
    get: (id) => document.getElementById(id),
    query: (sel) => document.querySelector(sel)
};

// ==========================
// INITIALIZATION
// ==========================
async function initQuiz() {
    showLoading();

    // FETCH SYLLABUS PATH
    const syllabusPath = localStorage.getItem("currentSyllabusPath");

    try {
        console.log("Fetching quiz for:", syllabusPath || "No file (using fallback)");
        const result = await generateQuiz({ filePath: syllabusPath });

        if (result.data.error) {
            throw new Error(result.data.error);
        }

        if (!result.data.questions || result.data.questions.length === 0) {
            throw new Error("No questions generated. Backend returned empty.");
        }

        quizData = result.data.questions;
        userAnswers = new Array(quizData.length).fill(null);

        hideLoading();
        startQuizUI();

    } catch (error) {
        console.error("Quiz Error:", error);
        dom.mainArea.innerHTML = `
            <div style="text-align: center; color: #f87171; padding: 40px;">
                <i class="fas fa-exclamation-circle" style="font-size: 48px; margin-bottom: 16px;"></i>
                <h2>Failed to Load Quiz</h2>
                <p>${error.message}</p>
                <div style="margin-top: 16px; font-size: 14px; color: #cbd5e1; background: rgba(0,0,0,0.2); padding: 10px; border-radius: 8px; display: inline-block;">
                    Error Details: ${error.message}
                </div>
                <br>
                <button onclick="location.reload()" class="btn-submit" style="margin-top: 20px;">Retry</button>
            </div>
        `;
    }
}

function startQuizUI() {
    // Re-query totalQuestions as it might be outside mainArea? 
    // In quiz.html, totalQuestions is in .progress-section. 
    // .progress-section is NOT inside .main-question-area. Safe.
    const totalQ = document.getElementById('totalQuestions');
    if (totalQ) totalQ.textContent = quizData.length;

    renderSidebar();
    loadQuestion(0);
    startTimer();
}

// ==========================
// LOADING STATE
// ==========================
function showLoading() {
    // Replaces content of main-question-area
    dom.mainArea.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 400px; color: #a78bfa;">
            <i class="fas fa-atom fa-spin" style="font-size: 64px; margin-bottom: 24px;"></i>
            <h2 style="color: #fff; margin-bottom: 8px;">Generating Your Quiz...</h2>
            <p style="color: #cbd5e1;">Analyzing syllabus concepts</p>
        </div>
    `;

    const qGrid = document.getElementById('questionGrid');
    if (qGrid) qGrid.innerHTML = '';
}

function hideLoading() {
    // We will restore structure in loadQuestion
}

// ==========================
// CORE FUNCTIONS
// ==========================

function loadQuestion(index) {
    const question = quizData[index];

    // 1. Restore Structure if needed
    // Check if we have the critical elements
    if (!document.getElementById('questionText')) {
        dom.mainArea.innerHTML = `
            <div class="question-header" id="questionCategory"></div>
            <div class="question-text" id="questionText"></div>
            <div class="options-container" id="optionsContainer"></div>
            
            <div class="navigation-buttons">
                <button class="nav-btn btn-previous">
                    <i class="fas fa-arrow-left"></i> Previous
                </button>
                <button class="nav-btn btn-next">
                    Next <i class="fas fa-arrow-right"></i>
                </button>
            </div>
            
            <div class="btn-submit-container" style="display:none">
                <button class="btn-submit">
                    <span>Submit Quiz</span>
                </button>
            </div>
        `;
        // Re-bind listeners since buttons are new
        bindButtonListeners();
    }

    // 2. Query Fresh Elements
    const qHeader = document.getElementById('questionCategory');
    const qText = document.getElementById('questionText');
    const optContainer = document.getElementById('optionsContainer');
    const qNum = document.getElementById('currentQuestion');
    const pFill = document.getElementById('progressFill');

    // 3. Update Content
    if (qNum) qNum.textContent = index + 1;
    if (qHeader) qHeader.textContent = `Question ${index + 1}: ${question.category}`;
    if (qText) qText.textContent = question.question;

    // Update Progress
    if (pFill) {
        const progressPercent = ((index + 1) / quizData.length) * 100;
        pFill.style.width = `${progressPercent}%`;
    }

    // Render Options
    if (optContainer) {
        optContainer.innerHTML = '';
        question.options.forEach((opt, i) => {
            const char = String.fromCharCode(65 + i); // A, B, C, D
            const isSelected = userAnswers[index] === i;

            const optionDiv = document.createElement('div');
            optionDiv.className = `option ${isSelected ? 'selected' : ''}`;
            // Use closure for click handler to avoid stale index issues
            optionDiv.onclick = () => selectOption(index, i);

            optionDiv.innerHTML = `
                <div class="option-label">${char}</div>
                <span>${opt}</span>
            `;

            optContainer.appendChild(optionDiv);
        });
    }

    updateSidebar(index);
    updateNavigationButtons();
}

function bindButtonListeners() {
    const btnPrev = document.querySelector('.btn-previous');
    const btnNext = document.querySelector('.btn-next');
    const btnSubmit = document.querySelector('.btn-submit');

    if (btnPrev) btnPrev.onclick = () => navigate(-1);
    if (btnNext) btnNext.onclick = () => navigate(1);
    if (btnSubmit) btnSubmit.onclick = submitQuiz;
}

function selectOption(qIndex, oIndex) {
    userAnswers[qIndex] = oIndex;

    const optContainer = document.getElementById('optionsContainer');
    if (!optContainer) return;

    // Update UI immediately
    const options = optContainer.querySelectorAll('.option');
    options.forEach(opt => opt.classList.remove('selected'));
    if (options[oIndex]) options[oIndex].classList.add('selected');

    updateSidebar(qIndex);
}

function navigate(direction) {
    const newIndex = currentQuestionIndex + direction;

    if (newIndex >= 0 && newIndex < quizData.length) {
        currentQuestionIndex = newIndex;
        loadQuestion(currentQuestionIndex);
    }
}

function updateNavigationButtons() {
    const prev = document.querySelector('.btn-previous');
    const next = document.querySelector('.btn-next');
    const submitCont = document.querySelector('.btn-submit-container');

    if (!prev) return;

    prev.disabled = currentQuestionIndex === 0;
    prev.style.opacity = currentQuestionIndex === 0 ? '0.5' : '1';
    prev.style.cursor = currentQuestionIndex === 0 ? 'not-allowed' : 'pointer';

    if (currentQuestionIndex === quizData.length - 1) {
        if (next) next.style.display = 'none';
        if (submitCont) submitCont.style.display = 'flex';
    } else {
        if (next) next.style.display = 'flex';
        if (submitCont) submitCont.style.display = 'none';
    }
}

// ==========================
// SIDEBAR
// ==========================
function renderSidebar() {
    const grid = document.getElementById('questionGrid');
    if (!grid) return;

    grid.innerHTML = '';

    quizData.forEach((_, i) => {
        const bubble = document.createElement('div');
        bubble.className = 'question-bubble unanswered';
        bubble.id = `bubble-${i}`;
        bubble.textContent = i + 1;
        bubble.onclick = () => {
            currentQuestionIndex = i;
            loadQuestion(i);
        };
        grid.appendChild(bubble);
    });
}

function updateSidebar(currentIndex) {
    quizData.forEach((_, i) => {
        const bubble = document.getElementById(`bubble-${i}`);
        if (!bubble) return;

        bubble.className = 'question-bubble';

        if (i === currentIndex) {
            bubble.classList.add('current');
            bubble.textContent = `Q${i + 1}`;
        } else if (userAnswers[i] !== null) {
            bubble.classList.add('answered');
            bubble.innerHTML = '<i class="fas fa-check"></i>';
        } else {
            bubble.classList.add('unanswered');
            bubble.textContent = i + 1;
        }
    });
}

// ==========================
// SUBMIT
// ==========================
function submitQuiz() {
    if (timerInterval) clearInterval(timerInterval);

    let score = 0;
    userAnswers.forEach((ans, i) => {
        if (ans !== null && ans === quizData[i].correct) score += 10;
    });

    const scoreVal = document.getElementById('score');
    if (scoreVal) scoreVal.textContent = score;

    showResultsOnly(score);
}

function showResultsOnly(score) {
    const maxScore = quizData.length * 10;
    const percentage = Math.round((score / maxScore) * 100);

    dom.mainArea.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <i class="fas fa-trophy" style="font-size: 64px; color: #fbbf24; margin-bottom: 24px; animation: trophy-bounce 2s infinite;"></i>
            <h2 style="color: #fff; font-size: 32px; margin-bottom: 16px;">Quiz Completed!</h2>
            <p style="color: #cbd5e1; font-size: 18px; margin-bottom: 32px;">You scored ${score} out of ${maxScore} points</p>
            
            <div style="width: 200px; height: 200px; margin: 0 auto 32px; position: relative; display: flex; align-items: center; justify-content: center;">
                <svg viewBox="0 0 36 36" style="width: 100%; height: 100%; transform: rotate(-90deg);">
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#1e293b" stroke-width="4" />
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#8b5cf6" stroke-width="4" stroke-dasharray="${percentage}, 100" />
                </svg>
                <div style="position: absolute; color: #fff; font-size: 48px; font-weight: bold;">${percentage}%</div>
            </div>
            
            <button onclick="location.reload()" class="btn-submit" style="margin: 0 auto;">
                <span>Try Again</span>
            </button>
        </div>
    `;
}

// ==========================
// TIMER
// ==========================
function startTimer() {
    updateTimerDisplay();
    if (timerInterval) clearInterval(timerInterval);

    timerInterval = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();

        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            submitQuiz();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const timeEl = document.getElementById('timeLeft');
    if (timeEl) timeEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Start
document.addEventListener('DOMContentLoaded', initQuiz);
