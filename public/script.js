// 1. IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getStorage, 
    ref, 
    uploadBytes, 
    connectStorageEmulator // <--- NEW IMPORT
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
import { 
    getFunctions, 
    httpsCallable, 
    connectFunctionsEmulator // <--- NEW IMPORT
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// 2. CONFIGURATION (Keep your keys here, they are safe locally)
const firebaseConfig = {
    apiKey: "AIzaSyDyCTS0DLLT-6pTSG_bPNdnUXjIbG2462E", // (Keep your real key)
    authDomain: "study-sprint-64688.firebaseapp.com",
    projectId: "study-sprint-64688",
    storageBucket: "study-sprint-64688.firebasestorage.app",
    messagingSenderId: "...", // (These last two are optional for local testing)
    appId: "..."
};

// 3. INITIALIZE & CONNECT TO LOCAL EMULATORS
const app = initializeApp(firebaseConfig);

const storage = getStorage(app);
connectStorageEmulator(storage, "127.0.0.1", 9199); // <--- Points to Local Storage

const functions = getFunctions(app);
connectFunctionsEmulator(functions, "127.0.0.1", 5001); // <--- Points to Local Python Backend


// ==========================================
// 3. GLOBAL VARIABLES & DOM ELEMENTS
// ==========================================
let uploadedFile = null;
let daysUntilExam = null;

const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');
const uploadContent = document.getElementById('uploadContent');
const examDateInput = document.getElementById('examDate');
const daysCounter = document.getElementById('daysCounter');
const daysText = document.getElementById('daysText');
const errorAlert = document.getElementById('errorAlert');
const errorText = document.getElementById('errorText');
const generateBtn = document.getElementById('generateBtn');
const btnText = document.getElementById('btnText');
const resultsCard = document.getElementById('resultsCard');
const studyTableBody = document.getElementById('studyTableBody');

// Set minimum date to today so users can't pick the past
const today = new Date().toISOString().split('T')[0];
examDateInput.setAttribute('min', today);

// ==========================================
// 4. EVENT LISTENERS (UI LOGIC)
// ==========================================

// --- File Upload Handling ---
uploadZone.addEventListener('click', () => {
    fileInput.click();
});

// Drag & Drop Visual Effects
uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.add('drag-active');
});

uploadZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('drag-active');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadZone.classList.remove('drag-active');
    
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileSelection(e.dataTransfer.files[0]);
    }
});

// Standard File Input Change
fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
        handleFileSelection(e.target.files[0]);
    }
});

function handleFileSelection(file) {
    hideError();
    
    // Validate PDF
    if (file.type !== 'application/pdf') {
        showError('Please upload PDF files only');
        uploadedFile = null;
        uploadZone.classList.remove('file-uploaded');
        return;
    }
    
    // Update State & UI
    uploadedFile = file;
    uploadZone.classList.add('file-uploaded');
    
    uploadContent.innerHTML = `
        <div class="upload-icon">
            <i class="fas fa-check-circle"></i>
        </div>
        <div class="file-name">${file.name}</div>
        <div class="upload-subtext">Click to change file</div>
    `;
}

// --- Date Picker Handling ---
examDateInput.addEventListener('change', (e) => {
    hideError();
    
    if (e.target.value) {
        const todayDate = new Date();
        todayDate.setHours(0, 0, 0, 0); // Reset time to midnight
        const examDate = new Date(e.target.value);
        examDate.setHours(0, 0, 0, 0);
        
        // Calculate difference in days
        const diffTime = examDate - todayDate;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) {
            showError('Please select a future date');
            daysUntilExam = null;
            daysCounter.style.display = 'none';
        } else {
            daysUntilExam = diffDays;
            daysText.textContent = `${diffDays} days until exam`;
            daysCounter.style.display = 'flex';
        }
    }
});

// --- Generate Button Click ---
generateBtn.addEventListener('click', async () => {
    if (!uploadedFile) {
        showError('Please upload a syllabus PDF');
        return;
    }
    
    if (!daysUntilExam || daysUntilExam < 0) {
        showError('Please select a valid exam date');
        return;
    }
    
    // Start the process
    await generateStudyPlan();
});

// ==========================================
// 5. CORE LOGIC (FIREBASE CONNECTION)
// ==========================================
async function generateStudyPlan() {
    hideError();
    setLoading(true); // Show spinner
    
    try {
        console.log("Step 1: Uploading file to Firebase Storage...");
        
        // A. Upload PDF to Storage
        // Path will be: syllabi/filename.pdf
        const storageRef = ref(storage, 'syllabi/' + uploadedFile.name);
        const snapshot = await uploadBytes(storageRef, uploadedFile);
        const fullPath = snapshot.metadata.fullPath;
        
        console.log("File uploaded. Path:", fullPath);
        console.log("Step 2: Calling Cloud Function...");

        // B. Call Python Cloud Function
        // Note: 'analyze_syllabus' must match the @https_fn.on_call function name in python
        const analyzeFunction = httpsCallable(functions, 'analyze_syllabus');
        
        const result = await analyzeFunction({ 
            filePath: fullPath,
            days: daysUntilExam 
        });
        
        console.log("Result received:", result.data);

        // C. Display the Result 
        const studyPlan = result.data.plan;
        displayStudyPlan(studyPlan);
        
    } catch (error) {
        console.error("Error generating plan:", error);
        showError('Failed to generate study plan. Check console for details.');
    } finally {
        setLoading(false); // Hide spinner
    }
}

// ==========================================
// 6. UI HELPER FUNCTIONS
// ==========================================

function displayStudyPlan(plan) {
    studyTableBody.innerHTML = '';
    
    // Loop through the JSON data and build table rows
    plan.forEach(topic => {
        const row = document.createElement('tr');
        
        // Determine Priority Badge Color
        const priorityBadgeClass = topic.priority === 'High' 
            ? 'badge-high-priority' 
            : 'badge-medium-priority';
        
        // Determine Difficulty Badge Color
        let difficultyBadgeClass;
        if (topic.difficulty === 'Easy') difficultyBadgeClass = 'badge-easy';
        else if (topic.difficulty === 'Medium') difficultyBadgeClass = 'badge-medium';
        else difficultyBadgeClass = 'badge-hard';
        
        // Insert HTML
        row.innerHTML = `
            <td class="topic-name">${topic.name}</td>
            <td><span class="badge ${priorityBadgeClass}">${topic.priority}</span></td>
            <td><span class="badge ${difficultyBadgeClass}">${topic.difficulty}</span></td>
            <td class="hours">${topic.hours} hours</td>
        `;
        
        studyTableBody.appendChild(row);
    });
    
    // Show the results card with animation
    resultsCard.classList.add('show');
    resultsCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function setLoading(isLoading) {
    generateBtn.disabled = isLoading;
    
    if (isLoading) {
        // Show Spinner
        const loaderDiv = document.createElement('div');
        loaderDiv.className = 'loader';
        const span = document.createElement('span');
        span.textContent = 'Analyzing Syllabus...';
        
        btnText.innerHTML = '';
        btnText.appendChild(loaderDiv);
        btnText.appendChild(span);
    } else {
        // Reset Text
        btnText.textContent = 'Generate Schedule';
    }
}

function showError(message) {
    errorText.textContent = message;
    errorAlert.classList.add('show');
}

function hideError() {
    errorAlert.classList.remove('show');
}