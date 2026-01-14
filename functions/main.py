from firebase_functions import https_fn
from firebase_admin import initialize_app, storage
import google.generativeai as genai
import json
import os
import tempfile
import re

# 1. Initialize Firebase Admin
initialize_app()

# 2. Configure Gemini
# It tries to read from the .env file. If that fails, it looks for a system variable.
GOOGLE_API_KEY = "AIzaSyBtycxDl7viHVyA85iwpIYiLMKW5A7ke_I"

genai.configure(api_key=GOOGLE_API_KEY)

# Try to auto-select a model that supports generateContent to avoid "model not found" errors.
# Falls back to the hardcoded default if listing fails or no compatible model is found.
DEFAULT_MODEL = "gemini-1.5-pro"
SELECTED_MODEL = DEFAULT_MODEL
try:
    print("🔎 Querying Generative API for available models...")
    for m in genai.list_models():
        # `m` is a `types.Model` dataclass with a `supported_generation_methods` list
        methods = getattr(m, "supported_generation_methods", [])
        name = getattr(m, "name", None)
        if name and "generateContent" in methods:
            SELECTED_MODEL = name
            print(f"✅ Selected model: {SELECTED_MODEL}")
            break
    else:
        print("⚠️ No model advertised 'generateContent' support; using default.")
except Exception as e:
    print(f"⚠️ Could not list models: {e}. Using default model: {DEFAULT_MODEL}")
    SELECTED_MODEL = DEFAULT_MODEL

@https_fn.on_call()
def analyze_syllabus(req: https_fn.CallableRequest):
    """
    Receives a file path and exam date, downloads the PDF, 
    sends it to Gemini, and returns a study plan.
    """
    try:
        print("\n🚀 Function 'analyze_syllabus' triggered!")
        
        # --- Step 1: Get Inputs from Frontend ---
        file_path = req.data["filePath"]
        days_left = req.data["days"]
        print(f"📄 Analyzing File: {file_path}")
        print(f"⏳ Days until exam: {days_left}")

        # --- Step 2: Download PDF from Emulator Storage ---
        bucket = storage.bucket()
        blob = bucket.blob(file_path)

        # Create a temporary file path on your computer to save the PDF
        # This works on Windows, Mac, and Linux automatically.
        temp_dir = tempfile.gettempdir()
        temp_filename = os.path.basename(file_path)
        local_temp_path = os.path.join(temp_dir, temp_filename)

        print(f"💾 Downloading to temp file: {local_temp_path}...")
        blob.download_to_filename(local_temp_path)

        # --- Step 3: Upload to Gemini ---
        print("☁️ Uploading file to Gemini...")
        gemini_file = genai.upload_file(path=local_temp_path, display_name="Syllabus")
        print("✅ File uploaded to Gemini successfully.")

        # --- Step 4: Prepare the Prompt ---
        prompt = f"""
        You are an expert student mentor. I have an exam in {days_left} days.
        I have attached my syllabus.
        
        TASK: Create a detailed study schedule to cover this entire syllabus.
        
        OUTPUT FORMAT RULES:
        1. Return ONLY valid JSON.
        2. Do not use Markdown code blocks (no ```json ... ```).
        3. The output must be a list of objects.
        4. Each object must have these exact keys:
           - "name": (String) Topic name
           - "priority": (String) "High" or "Medium"
           - "difficulty": (String) "Hard", "Medium", or "Easy"
           - "hours": (Integer) Study hours required
        """

        # --- Step 5: Generate Content ---
        print("🧠 Gemini is thinking...")
        model = genai.GenerativeModel(SELECTED_MODEL)
        try:
            response = model.generate_content([gemini_file, prompt])
        except Exception as gen_err:
            print(f"❌ Generation error: {str(gen_err)}")
            # Attempt to list available models to help debugging
            try:
                print("🔎 Listing available models from the Generative API:")
                for m in genai.list_models():
                    print(f"- {m}")
            except Exception as list_err:
                print(f"❌ Failed to list models: {str(list_err)}")
            # Re-raise so the outer handler returns an error to the frontend
            raise

        # --- Step 6: Clean and Parse JSON ---
        # Sometimes Gemini wraps the JSON in markdown code blocks. We remove them.
        response_text = response.text.replace("```json", "").replace("```", "").strip()
        
        try:
            study_plan = json.loads(response_text)
        except json.JSONDecodeError:
            # Fallback: If JSON is messy, try to find the list structure with Regex
            print("⚠️ JSON parsing failed directly. Trying Regex fix...")
            match = re.search(r'\[.*\]', response_text, re.DOTALL)
            if match:
                study_plan = json.loads(match.group(0))
            else:
                raise ValueError("Could not extract valid JSON from Gemini response.")

        print("✅ Study Plan generated successfully!")

        # --- Step 7: Cleanup ---
        # Remove the temp file from your computer to save space
        if os.path.exists(local_temp_path):
            os.remove(local_temp_path)

        # --- Step 8: Return to Frontend ---
        # Matches the 'result.data.plan' structure we set in script.js
        return {"plan": study_plan}

    except Exception as e:
        print(f"❌ ERROR in main.py: {str(e)}")
        # This sends the error message back to the browser console so you can see it
        raise https_fn.HttpsError(code=https_fn.FunctionsErrorCode.INTERNAL, message=str(e))