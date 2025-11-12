import joblib
import pandas as pd
from flask import Flask, request, jsonify, render_template, url_for
from flask_cors import CORS
import numpy as np
from scipy.stats import gaussian_kde

# --- NEW: Import SHAP ---
import shap

# --- NEW: Import libraries for .env and Gemini API ---
import os
import google.generativeai as genai
from dotenv import load_dotenv

# --- NEW: Load environment variables and configure API ---
load_dotenv()
api_key = os.environ.get("GOOGLE_API_KEY")

if api_key:
    genai.configure(api_key=api_key)
    print("✅ Google API Key configured successfully.")
else:
    print("❌ Error: GOOGLE_API_KEY not found in .env file.")
# --- END NEW ---

# --- Initialize Flask App ---
app = Flask(__name__, template_folder='templates', static_folder='static')
CORS(app)

# --- Load Model and Data ---
try:
    model = joblib.load('heart_disease_model.joblib')
    print("✅ Model loaded successfully.")
except FileNotFoundError:
    print("❌ Error: 'heart_disease_model.joblib' not found.")
    model = None

try:
    df_population = pd.read_csv('heart_fully_cleaned_and_engineered.csv')
    MODEL_COLUMNS = df_population.drop('HeartDisease', axis=1).columns
    print("✅ Population data loaded for column reference.")
except FileNotFoundError:
    print("❌ Error: 'heart_fully_cleaned_and_engineered.csv' not found.")
    df_population = None
    MODEL_COLUMNS = None

# --- NEW: Initialize SHAP Explainer ---
try:
    if model and df_population is not None:
        # Using shap.sample(..., 50) for a faster background dataset.
        background_data_df = shap.sample(df_population.drop('HeartDisease', axis=1), 50)
        
        # --- FIX #2: ---
        # 1. Give the explainer the NumPy array (.values) as the background.
        # 2. In the lambda, re-create the DataFrame from the array 'x'
        #    that SHAP passes in, using your MODEL_COLUMNS.
        explainer = shap.KernelExplainer(
            # FIX: Tell the explainer to ONLY explain the output for class 1
            lambda x: model.predict_proba(pd.DataFrame(x, columns=MODEL_COLUMNS))[:, 1], 
            background_data_df.values
        )
        print("✅ SHAP KernelExplainer initialized.")
    else:
        explainer = None
        print("⚠️ SHAP Explainer not initialized (model or data missing).")
except Exception as e:
    print(f"❌ Error initializing SHAP: {e}")
    explainer = None


# --- Page Serving Endpoints ---

@app.route('/')
def home():
    """Serves the 'index.html' file from the 'templates' folder."""
    return render_template('index.html')

@app.route('/predictor')
def predictor_page():
    """Serves the 'predictor.html' page with all the sliders."""
    return render_template('predictor.html')

@app.route('/analysis')
def analysis_page():
    """Serves the new AI analysis page."""
    return render_template('analysis.html')


# --- API Endpoint (MODIFIED for SHAP) ---

@app.route('/predict', methods=['POST'])
def predict():
    """
    The main prediction API. It now also calculates and returns
    SHAP values for the specific prediction.
    """
    if not model or MODEL_COLUMNS is None or explainer is None:
        return jsonify({'error': 'Model, reference data, or SHAP explainer not loaded. Check server logs.'}), 500

    try:
        data = request.get_json()
        
        # --- Data Preprocessing (Original) ---
        input_df = pd.DataFrame([data])
        
        # 1. Define all possible categories
        sex_cats = ['Sex_F', 'Sex_M']
        cpt_cats = ['ChestPainType_ASY', 'ChestPainType_ATA', 'ChestPainType_NAP', 'ChestPainType_TA']
        ecg_cats = ['RestingECG_LVH', 'RestingECG_Normal', 'RestingECG_ST']
        angina_cats = ['ExerciseAngina_N', 'ExerciseAngina_Y']
        slope_cats = ['ST_Slope_Down', 'ST_Slope_Flat', 'ST_Slope_Up']

        # 2. Convert categorical inputs to the one-hot format
        if 'Sex' in data:
            input_df['Sex_' + data['Sex']] = 1
        if 'ChestPainType' in data:
            input_df['ChestPainType_' + data['ChestPainType']] = 1
        if 'RestingECG' in data:
            input_df['RestingECG_' + data['RestingECG']] = 1
        if 'ExerciseAngina' in data:
            input_df['ExerciseAngina_' + data['ExerciseAngina']] = 1
        if 'ST_Slope' in data:
            input_df['ST_Slope_' + data['ST_Slope']] = 1
        
        # 3. Create a clean DataFrame with all model columns initialized to 0
        final_input_df = pd.DataFrame(columns=MODEL_COLUMNS, index=[0])
        final_input_df.fillna(0, inplace=True)
        
        # 4. Fill in the values from the input
        for col in input_df.columns:
            if col in final_input_df.columns:
                final_input_df[col] = input_df[col]
                
        # 5. Ensure the column order is identical to the training data
        final_input_df = final_input_df[MODEL_COLUMNS]
        # --- End Data Preprocessing ---

        # --- Model Prediction ---
        prediction_val = model.predict(final_input_df)[0]
        prediction_proba = model.predict_proba(final_input_df)[0]

        # --- NEW: SHAP Value Calculation (FIXED) ---
        
        # shap_values is now a single array (shape [1, num_features]), 
        # not a list of arrays, because we specified '[:, 1]' in the explainer.
        shap_values = explainer.shap_values(final_input_df) 
        
        # Get the first (and only) row of explanations
        shap_values_for_user = shap_values[0] 
        
        # Create a dictionary of {feature: shap_value}
        shap_data = {col: round(val, 4) for col, val in zip(MODEL_COLUMNS, shap_values_for_user)}
        # --- END NEW ---
        # --- END NEW ---

        # --- MODIFIED: Return SHAP data along with prediction ---
        result = {
            'prediction': int(prediction_val),
            'confidence_low_risk': f"{prediction_proba[0]:.2%}",
            'confidence_high_risk': f"{prediction_proba[1]:.2%}",
            'shap_data': shap_data  # Send the SHAP values to the frontend
        }
        return jsonify(result)

    except Exception as e:
        error_msg = f'An error occurred during prediction: {str(e)}'
        print(f"❌ PREDICTION ERROR: {error_msg}")
        return jsonify({'error': error_msg}), 400

# --- Plotting Function and Endpoint (Unchanged) ---

def calculate_kde(data):
    """Calculates the x, y coordinates for a density plot."""
    kde = gaussian_kde(data.dropna()) # Add .dropna() for safety
    x_grid = np.linspace(data.min(), data.max(), 200)
    kde_values = kde.evaluate(x_grid)
    return list(x_grid), list(kde_values)

@app.route('/plot_data')
def plot_data():
    """Endpoint to send population data to the frontend."""
    if df_population is None:
        return jsonify({'error': 'Population data not loaded on server.'}), 500
        
    try:
        plot_data = {}
        features = ['RestingBP', 'Cholesterol', 'RestingHR', 'MaxHR', 'Oldpeak']
        
        df_no_disease = df_population[df_population['HeartDisease'] == 0]
        df_heart_disease = df_population[df_population['HeartDisease'] == 1]

        for feature in features:
            if feature not in df_population.columns:
                print(f"Warning: Column '{feature}' not found in CSV for plotting.")
                continue 
            
            x_no, y_no = calculate_kde(df_no_disease[feature])
            x_yes, y_yes = calculate_kde(df_heart_disease[feature])
            
            plot_data[feature] = {
                'no_disease_x': x_no,
                'no_disease_y': y_no,
                'heart_disease_x': x_yes,
                'heart_disease_y': y_yes,
            }
        
        return jsonify(plot_data)

    except Exception as e:
        error_message = f'An error occurred generating plot data: {str(e)}'
        print(f"❌ PLOT DATA ERROR: {error_message}")
        return jsonify({'error': error_message}), 500

# --- MODIFIED: AI Analysis Endpoint (Now SHAP-aware) ---
@app.route('/get_ai_analysis', methods=['POST'])
def get_ai_analysis():
    """
    Receives patient data AND SHAP data from the frontend, 
    calls the Gemini API, and returns the AI-generated text.
    """
    if not api_key:
        return jsonify({'error': 'Google API Key not configured on server. Check .env file.'}), 500

    try:
        # Get data from the request, which now includes 'shap_data'
        data = request.get_json()
        shap_data = data.get('shap_data', {})

        # --- Process SHAP data to find top contributors ---
        # Filter out features with near-zero importance
        significant_factors = {k: v for k, v in shap_data.items() if abs(v) > 0.01}
        # Sort by the absolute magnitude of the SHAP value
        sorted_factors = sorted(significant_factors.items(), key=lambda item: abs(item[1]), reverse=True)
        
        shap_string = "\nHere are the top factors that influenced your specific prediction:\n"
        for feature, value in sorted_factors[:5]: # Get top 5
            shap_string += f"- {feature} (SHAP Value: {value:.4f})\n"
        
        if not sorted_factors:
            shap_string = "\nNo single factor strongly influenced this prediction.\n"
        # --- End SHAP processing ---


        # --- MODIFIED: System Prompt ---
        # The prompt is now aware of SHAP and the population plots.
        system_prompt = (
            "You are a compassionate health analyst and cardiologist. "
            "Your job is to explain a person's heart disease risk using their data and their personal SHAP (SHapley Additive exPlanations) values. "
            "Do not give medical advice or a diagnosis. Your response must be in Markdown."
            "\n"
            "**Key Concepts to Use:**"
            "1.  **SHAP Values:** The user will provide SHAP values. A **positive SHAP value** means that feature **pushed the prediction towards 'Heart Disease'**. A **negative SHAP value** means it **pushed the prediction towards 'No Heart Disease'**. The *magnitude* shows its importance."
            "2.  **Population Comparison (Like the plots):** The user will provide their personal values (e.g., 'Cholesterol: 270'). You must compare this to general health ranges to give context. For example, 'Your Cholesterol of 270 is high. This is a level more commonly seen in populations with heart disease.'"
            "\n"
            "**Your Response Structure:**"
            "1.  **Summary:** Start with a brief, clear summary of their AI-predicted result."
            "2.  **Key Factors (Based on SHAP):** Create a bulleted list of the *most significant factors* from their SHAP list. For each factor, explain **what their value was** (e.g., 'ST_Slope: Up') and **how it influenced the result** using the SHAP value (e.g., 'This was the *strongest factor* pushing your risk *higher*...')."
            "3.  **Context (Based on Population Plots):** Weave in explanations for *why* their personal values matter (e.g., 'Your Resting Blood Pressure of 148 is elevated...')."
            "4.  **Conclusion:** End with a friendly, encouraging general wellness statement."
        )

        # --- MODIFIED: User Data String ---
        # Now includes the dynamic SHAP string
        user_data_string = (
            f"Here is my data:\n"
            f"- My AI-predicted risk: {data.get('prediction', 'N/A')} (Confidence: {data.get('confidence', 'N/A')})\n"
            f"- Age: {data.get('Age', 'N/A')}\n"
            f"- Sex: {data.get('Sex', 'N/A')}\n"
            f"- Chest Pain Type: {data.get('ChestPainType', 'N/A')}\n"
            f"- Resting Blood Pressure: {data.get('RestingBP', 'N/A')} mm Hg\n"
            f"- Cholesterol: {data.get('Cholesterol', 'N/A')} mg/dl\n"
            f"- Fasting Blood Sugar > 120 mg/dl: {'Yes' if data.get('FastingBS') == '1' else 'No'}\n"
            f"- Resting ECG: {data.get('RestingECG', 'N/A')}\n"
            f"- Max Heart Rate: {data.get('MaxHR', 'N/A')} bpm\n"
            f"- Exercise-Induced Angina: {'Yes' if data.get('ExerciseAngina') == 'Y' else 'No'}\n"
            f"- Oldpeak (ST Depression): {data.get('Oldpeak', 'N/A')}\n"
            f"- ST Slope: {data.get('ST_Slope', 'N/A')}\n"
            f"- My Measured Resting Heart Rate: {data.get('RestingHR', 'N/A')} bpm\n"
            f"- My Measured HRV: {data.get('HRV', 'N/A')} ms\n"
            f"{shap_string}"  # <-- We add the SHAP explanation here!
            "\nPlease provide a complete analysis based on all this information."
        )

        # Call the Gemini API
        model = genai.GenerativeModel(
            # FIX: Using the latest stable flash model
            model_name='gemini-2.5-flash', 
            system_instruction=system_prompt
        )
        response = model.generate_content(user_data_string)

        return jsonify({'text': response.text})

    except Exception as e:
        error_msg = f'An error occurred calling Gemini API: {str(e)}'
        print(f"❌ GEMINI API ERROR: {error_msg}")
        return jsonify({'error': error_msg}), 500
# --- END MODIFIED ---

# --- Run the App ---
if __name__ == '__main__':
    app.run(debug=True, port=5000)