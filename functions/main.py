from firebase_functions import https_fn
from firebase_admin import initialize_app
import google.generativeai as genai
import os
from dotenv import load_dotenv

initialize_app()
load_dotenv()

# --- 1. CONFIGURATION ---
GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY")

# Setup Gemini
genai.configure(api_key=GOOGLE_API_KEY)

@https_fn.on_call()
def analyze_syllabus(req: https_fn.CallableRequest) -> dict:
    print("🚀 Function triggered!")
    
    # 1. Check if Key is loaded
    if not GOOGLE_API_KEY or "YOUR_KEY" in GOOGLE_API_KEY:
        print("❌ API Key is missing or invalid.")
        return {"plan": [{"name": "Error: API Key Missing", "priority": "High", "difficulty": "Hard", "hours": 0}]}

    # 2. Extract Data from Frontend
    try:
        data = req.data
        days = data.get("days", 7)
        file_path = data.get("filePath")
        print(f"📄 Analyzing file: {file_path} for {days} days")
    except Exception as e:
        print(f"❌ Error reading request: {e}")
        return {"plan": []}

    # 3. Generate Content with fallback if preferred model isn't available
    try:
        preferred = 'gemini-1.5-flash-001'

        # Build prompt
        prompt = f"""
        Create a study plan for {days} d ays.
        Return a JSON list of objects.
        Each object must have: 'name', 'priority' (High/Medium/Low), 'difficulty' (Easy/Medium/Hard), 'hours' (integer).
        Do not use Markdown formatting. Just raw JSON.
        Subject: Engineering Calculus.
        """

        def generate_with(model_name):
            print(f"🧠 Trying model: {model_name}")
            m = genai.GenerativeModel(model_name)
            return m.generate_content(prompt)

        # Try preferred model first
        try:
            response = generate_with(preferred)
            print("✅ Responded with preferred model")
        except Exception as first_err:
            print(f"⚠️ Preferred model failed: {first_err}")
            # Try to find a suitable model
            try:
                models = genai.list_models()
                print("📋 Fetched models list")
                candidate = None
                for m in models:
                    # support dict or object shapes
                    m_name = None
                    if isinstance(m, dict):
                        m_name = m.get('name') or m.get('id') or m.get('model')
                    else:
                        m_name = getattr(m, 'name', None) or getattr(m, 'id', None) or getattr(m, 'model', None)

                    if not m_name:
                        continue

                    lname = m_name.lower()
                    # prefer gemini / bison models
                    if 'gemini' in lname or 'bison' in lname:
                        candidate = m_name
                        break

                if not candidate:
                    raise RuntimeError('No candidate generation model found')

                response = generate_with(candidate)
                print(f"✅ Responded with fallback model {candidate}")

            except Exception as list_err:
                print(f"❌ Could not find/use fallback: {list_err}")
                return {"plan": [{"name": "Error: " + str(list_err), "priority": "High", "difficulty": "Hard", "hours": 0}]}

        # Normalize response text
        clean_text = getattr(response, 'text', None) or str(response)
        clean_text = clean_text.replace('```json', '').replace('```', '').strip()

        import json
        plan = json.loads(clean_text)
        return {"plan": plan}

    except Exception as e:
        print(f"❌ CRITICAL ERROR: {e}")
        return {"plan": [{"name": "Error: " + str(e), "priority": "High", "difficulty": "Hard", "hours": 0}]}