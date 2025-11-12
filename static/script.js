// This script contains all frontend logic:
// 1. Prediction Form submission
// 2. Live PPG Measurement
// 3. Live Population Plots
// 4. AI Explanation Page Link

document.addEventListener('DOMContentLoaded', () => {
    
    // =================================================================
    // --- 1. PREDICTION FORM LOGIC ---
    // =================================================================

    // --- Form & Prediction Elements ---
    const form = document.getElementById('prediction-form');
    const resultBox = document.getElementById('result-box');
    const resultText = document.getElementById('result-text');
    const loadingIndicator = document.getElementById('loading');
    const predictButton = document.getElementById('predict-button');

    // --- ADDED: AI Explanation Elements ---
    const analysisButton = document.getElementById('go-to-analysis-button');
    let lastPredictionResult = null; // To store the result for the AI
    if (analysisButton) analysisButton.disabled = true; // Disable on load
    // --- END ---

    // Ensure form exists before adding listener
    if (form) {
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            
            // --- ADDED: Reset AI button on new prediction ---
            if (analysisButton) analysisButton.disabled = true;
            // --- END ---

            // Ensure elements exist before modifying
            if (loadingIndicator) loadingIndicator.classList.remove('hidden');
            if (resultBox) {
                resultBox.classList.remove('high-risk', 'low-risk');
                resultBox.classList.add('bg-gray-700', 'border-gray-600'); // Reset to default
            }
             if (resultText) resultText.innerHTML = "Awaiting input...";
            if (predictButton) {
                predictButton.disabled = true;
                predictButton.textContent = 'Calculating...';
            }

            const formData = new FormData(form);
            const data = {};
            formData.forEach((value, key) => {
                // Check if value is numeric and convert, otherwise send as string
                const numValue = Number(value);
                data[key] = isNaN(numValue) ? value : numValue;
            });

            try {
                // Use an absolute path for the API endpoint
                const response = await fetch('http://localhost:5000/predict', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                if (!response.ok) {
                    let errorMsg = `HTTP error! status: ${response.status}`;
                    try {
                        const errorData = await response.json();
                        errorMsg = errorData.error || errorMsg;
                    } catch (jsonError) {
                        console.error("Could not parse error JSON:", jsonError);
                    }
                    throw new Error(errorMsg);
                }
                const result = await response.json();
                displayResult(result);
            } catch (error) {
                 if (resultBox && resultText) {
                    resultBox.className = 'border-l-4 p-4 rounded-md high-risk';
                    resultText.innerHTML = `<span class="font-bold">Error:</span> ${error.message}`;
                } else {
                    console.error("Result display elements not found.");
                }
            } finally {
                if (loadingIndicator) loadingIndicator.classList.add('hidden');
                if (predictButton) {
                    predictButton.disabled = false;
                    predictButton.textContent = 'Predict Risk';
                }
            }
        });
    } else {
         console.error("Prediction form not found.");
    }


    function displayResult(result) {
        if (!resultBox || !resultText) {
             console.error("Result display elements not found for displaying result.");
             return;
        }
        if (result.prediction === 1) {
            resultBox.className = 'border-l-4 p-4 rounded-md high-risk'; // Applies dark-mode red
            resultText.innerHTML = `<span class="font-bold text-xl">High Risk</span> of Heart Disease<br><span class="text-sm">Confidence: ${result.confidence_high_risk}</span>`;
        } else {
            resultBox.className = 'border-l-4 p-4 rounded-md low-risk'; // Applies dark-mode green
            resultText.innerHTML = `<span class="font-bold text-xl">Low Risk</span> of Heart Disease<br><span class="text-sm">Confidence: ${result.confidence_low_risk}</span>`;
        }

        // --- ADDED: Store result and enable AI button ---
        lastPredictionResult = result;
        if (analysisButton) analysisButton.disabled = false;
        // --- END ---
    }

    // =================================================================
    // --- 2. LIVE PPG MEASUREMENT LOGIC ---
    // =================================================================

    // --- PPG Measurement Elements ---
    const startPpgButton = document.getElementById('start-ppg-button');
    const ppgStatus = document.getElementById('ppg-status');
    const video = document.getElementById('video');
    const ppgChartDiv = document.getElementById('ppg-chart');
    const canvas = document.getElementById('output-canvas');
    const ctx = canvas ? canvas.getContext('2d') : null;

    let ppgInterval; // To hold the interval for PPG processing
    let currentStream; // To hold the active media stream

    let lineArr = [];
    const MAX_LENGTH = 100;
    let chart;
    let frameCount = 0;
    let goodFramesCount = 0; // Track valid frames
    const MEASUREMENT_DURATION_FRAMES = 450; // Approx 15 seconds at 30fps

    // Ensure PPG elements exist before adding listener
    if (startPpgButton && ppgStatus && video && ppgChartDiv && canvas && ctx) {
        startPpgButton.addEventListener('click', startMeasurement);
    } else {
        console.warn("PPG measurement elements not found. Disabling PPG functionality.");
        if (startPpgButton) startPpgButton.disabled = true;
    }


    async function startMeasurement() {
        if (currentStream) {
            stopMeasurement();
        }

        // --- Camera Access with Fallback ---
        let stream;
        const idealWidth = 640;
        const idealHeight = 480;
        const idealFrameRate = 30;

        try {
            // 1. Try rear camera
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: 'environment',
                    width: { ideal: idealWidth },
                    height: { ideal: idealHeight },
                    frameRate: { ideal: idealFrameRate }
                }
            });
            console.log("Using rear camera.");
        } catch (err) {
            console.log("Rear camera failed or not available. Trying default camera.", err.name);
            try {
                // 2. Try any camera
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: idealWidth },
                        height: { ideal: idealHeight },
                        frameRate: { ideal: idealFrameRate }
                    }
                });
                console.log("Using default camera.");
            } catch (err2) {
                // 3. Both failed
                console.error("Camera Error (both attempts failed):", err2.name, err2.message);
                if (ppgStatus) ppgStatus.textContent = `Error: Could not access camera (${err2.name}). Check browser/system permissions.`;
                if (startPpgButton) startPpgButton.disabled = false;
                return;
            }
        }
        // --- End Camera Access ---

        currentStream = stream;
        if (video) {
            video.srcObject = stream;
            video.classList.remove('hidden');
        }
        if (startPpgButton) startPpgButton.disabled = true;
        if (ppgStatus) ppgStatus.textContent = 'Place your finger gently over the camera...';

        video.onloadedmetadata = () => {
            video.play();
            if (ppgStatus) ppgStatus.textContent = 'Measuring... Please hold still.';

            if (video.videoWidth > 0 && video.videoHeight > 0) {
                if (canvas) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                }
            } else {
                console.warn("Video dimensions are zero, canvas size not set.");
            }


            // Attempt to turn on the torch safely
            try {
                const track = stream.getVideoTracks()[0];
                const capabilities = track.getCapabilities();
                if (capabilities.torch) {
                    track.applyConstraints({ advanced: [{ torch: true }] })
                        .then(() => console.log("Torch turned on."))
                        .catch(e => console.warn('Torch available but failed to activate:', e.name));
                } else {
                    console.log("Torch capability not available on this camera.");
                }
            } catch (e) {
                console.warn("Could not check or apply torch constraints:", e);
            }

            // Initialize/reset chart and counters
            lineArr = [];
            frameCount = 0;
            goodFramesCount = 0;

            chart = realTimeLineChart();
            const chartContainer = d3.select("#ppg-chart");
            if (chartContainer.empty()) {
                console.error("PPG Chart container not found.");
                stopMeasurement();
                return;
            }
            chartContainer.html("");
            chartContainer.datum(lineArr).call(chart);


            clearInterval(ppgInterval);
            ppgInterval = setInterval(processFrame, 1000 / idealFrameRate);
        };

        video.onerror = (e) => {
            console.error("Video error:", e);
            if (ppgStatus) ppgStatus.textContent = 'Video playback error.';
            stopMeasurement();
        };
    }

    function processFrame() {
        if (!video || video.paused || video.ended || !ctx || !currentStream) {
            console.log("Stopping measurement due to video state or missing context/stream.");
            stopMeasurement();
            return;
        }

        if (frameCount >= MEASUREMENT_DURATION_FRAMES) {
            console.log("Measurement duration reached.");
            finishMeasurement();
            return;
        }

        frameCount++;

        try {
            if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
                if (video.videoWidth > 0 && video.videoHeight > 0) {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                } else {
                    console.warn("Skipping frame, invalid video dimensions.");
                    return;
                }
            }

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = frame.data;
            let redSum = 0;
            const pixelCount = data.length / 4;

            if (pixelCount === 0) {
                console.warn("Skipping frame, zero pixels detected.");
                return;
            }

            for (let i = 0; i < data.length; i += 4) {
                redSum += data[i]; // Index 0 is Red
            }
            const redAverage = redSum / pixelCount;

            if (frameCount % 30 === 0) { // Log value once per second
                console.log(`Avg. Red: ${redAverage.toFixed(0)}`);
            }

            // Check for *either* very dark (webcam) or very bright (phone + torch)
            const FINGER_THRESHOLD_DARK = 50;
            const FINGER_THRESHOLD_BRIGHT = 200;
            
            if (redAverage < FINGER_THRESHOLD_DARK || redAverage > FINGER_THRESHOLD_BRIGHT) {
                goodFramesCount++;
            }

            // Normalize the signal
            const normalizedSignal = 1 - (Math.max(0, Math.min(255, redAverage)) / 255);

            // Update chart data
            lineArr.push({ time: frameCount, x: normalizedSignal });
            if (lineArr.length > MAX_LENGTH) {
                lineArr.shift();
            }

            // Redraw chart
            if (chart) {
                const chartContainer = d3.select("#ppg-chart");
                if (!chartContainer.empty()) {
                    chartContainer.datum(lineArr).call(chart);
                }
            } else {
                console.warn("Chart object not initialized, cannot redraw.");
            }

        } catch (e) {
            console.error("Error processing frame:", e);
        }
    }

    function finishMeasurement() {
        console.log("Finishing measurement.");

        // --- CRITICAL FIX ---
        // 1. Store the final counts *before* they are reset.
        const finalFrameCount = frameCount;
        const finalGoodFramesCount = goodFramesCount;
        
        // 2. NOW stop the measurement and clean up.
        stopMeasurement();
        // --- END OF FIX ---

        // 3. Perform validity check using the *stored* final counts.
        const VALIDITY_THRESHOLD_PERCENT = 0.75;
        const validityRatio = (finalFrameCount > 0) ? (finalGoodFramesCount / finalFrameCount) : 0;

        console.log(`Measurement validity: ${finalGoodFramesCount} good frames out of ${finalFrameCount} total. Ratio: ${validityRatio.toFixed(2)}`);

        if (validityRatio >= VALIDITY_THRESHOLD_PERCENT) {
            // --- SUCCESS: Finger was present ---
            if (ppgStatus) ppgStatus.innerHTML = '<span class="font-bold text-green-500">Measurement Complete!</span>';

            // --- SIMULATION ---
            const simulatedHR = Math.floor(Math.random() * (95 - 60 + 1)) + 60;
            const simulatedHRV = (Math.random() * (80 - 35) + 35).toFixed(1);
            console.log(`Simulated HR: ${simulatedHR}, HRV: ${simulatedHRV}`);

            // Update the form sliders
            const hrSlider = document.getElementById('RestingHR');
            const hrvSlider = document.getElementById('HRV');
            const hrValueDisplay = document.getElementById('RestingHR-value');
            const hrvValueDisplay = document.getElementById('HRV-value');

            if (hrSlider && hrValueDisplay) {
                hrSlider.value = simulatedHR;
                hrValueDisplay.innerText = simulatedHR;
            } else {
                console.warn("HR slider or value display not found.");
            }
            if (hrvSlider && hrvValueDisplay) {
                hrvSlider.value = simulatedHRV;
                hrvValueDisplay.innerText = simulatedHRV;
            } else {
                console.warn("HRV slider or value display not found.");
            }
            // --- END SIMULATION ---

            // Manually call updatePlotLines() to sync the plot
            // with the new slider values from the simulation.
            updatePlotLines();

        } else {
            // --- FAILURE: Finger was not present ---
            console.warn("Measurement failed: Finger not detected consistently.");
            if (ppgStatus) ppgStatus.innerHTML = '<span class="font-bold text-red-500">Measurement Failed.</span><br><span class="text-sm">Please place your finger fully over the camera and hold still.</span>';
        }
    }

    function stopMeasurement() {
        console.log("Stopping measurement and cleaning up.");
        clearInterval(ppgInterval);
        ppgInterval = null;

        if (currentStream) {
            currentStream.getTracks().forEach(track => {
                track.stop();
                console.log(`Track stopped: ${track.kind}`);
            });
            currentStream = null;
        }
        if (video) {
            video.srcObject = null;
            video.classList.add('hidden');
        }

        if (startPpgButton) {
            startPpgButton.disabled = false;
            startPpgButton.textContent = 'Start Measurement';
        }

        // Reset global counters for the *next* run
        frameCount = 0;
        goodFramesCount = 0;

        const chartContainer = d3.select("#ppg-chart");
        if (!chartContainer.empty()) {
            chartContainer.html("");
        }
        lineArr = [];

        // Reset status message *only* if it wasn't already showing "Complete" or "Failed"
        const currentStatus = ppgStatus ? ppgStatus.textContent : "";
        if (ppgStatus && (currentStatus.includes("Measuring") || currentStatus.includes("Place your finger"))) {
             ppgStatus.textContent = 'Press start to measure HR and HRV.';
        }
    }


    // --- D3 Real-time Chart ---
    function realTimeLineChart() {
        let width = 300, height = 150, margin = { top: 10, right: 10, bottom: 20, left: 35 };

        function chartFn(selection) {
            selection.each(function (data) {
                const container = d3.select(this);

                let currentWidth = width;
                try {
                    const containerWidth = container.node().getBoundingClientRect().width;
                    currentWidth = (containerWidth > margin.left + margin.right) ? containerWidth : width;
                } catch (e) {
                    console.warn("Could not get container width for chart:", e);
                }

                let svg = container.selectAll("svg").data([null]);
                let svgEnter = svg.enter().append("svg")
                    .attr("width", currentWidth)
                    .attr("height", height);

                let g = svgEnter.append("g")
                    .attr("transform", `translate(${margin.left},${margin.top})`);

                g.append("g").attr("class", "x axis");
                g.append("g").attr("class", "y axis");
                g.append("path").attr("class", "line");

                let svgUpdate = svg.merge(svgEnter);
                svgUpdate.attr("width", currentWidth).attr("height", height);
                let gUpdate = svgUpdate.select("g");
                let innerWidth = currentWidth - margin.left - margin.right;
                let innerHeight = height - margin.top - margin.bottom;

                if (innerWidth <= 0 || innerHeight <= 0) {
                    console.warn("Chart dimensions invalid, skipping render.", { innerWidth, innerHeight });
                    return;
                }

                let x = d3.scaleLinear().range([0, innerWidth]);
                let y = d3.scaleLinear().range([innerHeight, 0]);

                if (data && data.length > 0) {
                    x.domain(d3.extent(data, d => d.time));
                    let yExtent = d3.extent(data, d => d.x);
                    let yPadding = (yExtent[1] - yExtent[0]) * 0.15;
                    if (yPadding === 0 || isNaN(yPadding)) yPadding = 0.01;
                    let yMin = yExtent[0] - yPadding;
                    let yMax = yExtent[1] + yPadding;
                    if (isNaN(yMin) || isNaN(yMax)) { yMin = 0.4; yMax = 0.6; }
                    y.domain([yMin, yMax]);
                } else {
                    x.domain([0, MAX_LENGTH]);
                    y.domain([0.4, 0.6]);
                }

                let line = d3.line()
                    .x(d => x(d.time))
                    .y(d => y(d.x))
                    .defined(d => !isNaN(d.time) && !isNaN(d.x));

                gUpdate.select(".x.axis")
                    .attr("transform", `translate(0,${innerHeight})`)
                    .transition().duration(50)
                    .call(d3.axisBottom(x).ticks(5).tickSizeOuter(0));

                gUpdate.select(".y.axis")
                    .transition().duration(50)
                    .call(d3.axisLeft(y).ticks(3).tickFormat(d3.format(".3f")));

                gUpdate.select(".line")
                    .datum(data)
                    .transition().duration(50)
                    .attr("d", line);
            });
        }
        return chartFn;
    }

    // Optional: Add resize listener for chart
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (chart && !d3.select("#ppg-chart").empty()) {
                console.log("Window resized, redrawing chart.");
                chart = realTimeLineChart();
                d3.select("#ppg-chart").datum(lineArr).call(chart);
            }
        }, 250);
    });
    
    // =================================================================
    // --- 3. LIVE POPULATION PLOT LOGIC ---
    // =================================================================
    
    // Get references to all the sliders. 
    // IMPORTANT: Make sure the 'id' in your HTML matches these names.
    const plotInputs = {
        'RestingBP': document.getElementById('RestingBP'),
        'Cholesterol': document.getElementById('Cholesterol'),
        'RestingHR': document.getElementById('RestingHR'),
        'MaxHR': document.getElementById('MaxHR'),
        'Oldpeak': document.getElementById('Oldpeak')
    };

    // Store the plot data globally so we can access it
    let populationPlotData = null;

    // This function draws the initial plots
    async function initializePlots() {
        try {
            // Fetch data from the new endpoint, using an absolute path
            const response = await fetch('http://localhost:5000/plot_data');
            
            // --- MODIFICATION: Better error handling ---
            // If the response fails (e.g., 500 error from Python)
            if (!response.ok) {
                let errorMsg = `HTTP error! status: ${response.status}`;
                try {
                    // Try to get the specific JSON error from app.py
                    const errorData = await response.json();
                    errorMsg = errorData.error || errorMsg;
                } catch (jsonError) {
                    // Fallback if the error message isn't JSON
                    console.error("Could not parse plot error JSON:", jsonError);
                }
                throw new Error(errorMsg); // This will be caught by the 'catch' block
            }
            // --- END MODIFICATION ---

            populationPlotData = await response.json();
            
            // Draw each plot
            drawPlotlyChart('Oldpeak');
            drawPlotlyChart('MaxHR');
            drawPlotlyChart('RestingHR');
            drawPlotlyChart('Cholesterol');
            drawPlotlyChart('RestingBP');

            // Now that plots are drawn, update the lines to match the form's default values
            updatePlotLines();

        } catch (error) {
            console.error("Could not fetch or draw plot data:", error);
            
            // --- MODIFICATION: Display the specific error message ---
            const plotDiv = document.getElementById('Oldpeak-plot');
            if (plotDiv) {
                let errorMsg = error.message;
                if (error.message.includes('Failed to fetch')) {
                    errorMsg = "Failed to connect to server. Is the Python server (app.py) running on port 5000?";
                }
                // Display the more detailed error message
                plotDiv.innerHTML = `<p class="text-red-400 text-center"><b>Could not load population plots.</b><br><span class="text-sm text-gray-400">${errorMsg}</span></p>`;
            }
            // --- END MODIFICATION ---
        }
    }

    // This function draws a single plot
    function drawPlotlyChart(featureName) {
        if (!populationPlotData || !populationPlotData[featureName]) {
            console.warn(`No plot data found for ${featureName}`);
            const plotDivEl = document.getElementById(`${featureName}-plot`);
            if (plotDivEl) plotDivEl.style.display = 'none'; // Hide div if no data
            return;
        }
        
        const data = populationPlotData[featureName];
        const plotDiv = `${featureName}-plot`; // e.g., "Cholesterol-plot"
        
        // 1. "No Heart Disease" trace (green)
        const trace1 = {
            x: data.no_disease_x,
            y: data.no_disease_y,
            type: 'scatter',
            mode: 'lines',
            name: 'No Heart Disease',
            fill: 'tozeroy',
            line: { color: '#22c55e', width: 2 } // Green-500
        };

        // 2. "Heart Disease" trace (red)
        const trace2 = {
            x: data.heart_disease_x,
            y: data.heart_disease_y,
            type: 'scatter',
            mode: 'lines',
            name: 'Heart Disease',
            fill: 'tozeroy',
            line: { color: '#ef4444', width: 2 } // Red-500
        };

        // Get the current value from the form
        const currentValue = plotInputs[featureName] ? plotInputs[featureName].value : 0;

        const layout = {
            title: {
                text: `Distribution of ${featureName}`,
                font: { size: 16, color: '#e5e7eb' },
                y: 0.95 // Adjust title position
            },
            autosize: true,
            paper_bgcolor: 'transparent', // Match your dark theme
            plot_bgcolor: 'transparent',
            font: { color: '#e5e7eb' }, // Light text (gray-200)
            xaxis: { gridcolor: '#4b5563' }, // gray-600
            yaxis: { 
                gridcolor: '#4b5563', // gray-600
                showticklabels: false, // Hide Y-axis labels
                zeroline: false
            },
            margin: { l: 20, r: 20, b: 40, t: 40, pad: 0 }, // Tight margins
            legend: {
                orientation: 'h',
                yanchor: 'bottom',
                y: 1.02,
                xanchor: 'right',
                x: 1,
                font: { size: 10 }
            },
            // This is the dashed "Your Value" line
            shapes: [{
                type: 'line',
                x0: currentValue,
                x1: currentValue,
                y0: 0,
                y1: 1,
                yref: 'paper', // Stretches from bottom (0) to top (1)
                name: 'Your Value',
                line: {
                    color: '#f5f5f5', // Neutral-100
                    width: 2.5,
                    dash: 'dash'
                }
            }]
        };

        const config = { 
            responsive: true, // Make it responsive
            displayModeBar: false // Hide the Plotly icon bar
        };
        
        Plotly.newPlot(plotDiv, [trace1, trace2], layout, config);
    }

    // This function is called every time a slider moves
    function updatePlotLines() {
        if (!populationPlotData) return; // Don't run if data isn't loaded

        for (const featureName in plotInputs) {
            const input = plotInputs[featureName];
            const plotDivId = `${featureName}-plot`;
            // Check if input and its corresponding plot div exist
            if (input && populationPlotData[featureName] && document.getElementById(plotDivId)) {
                const newValue = input.value;
                
                // Use Plotly.relayout to efficiently update the line's x-position
                Plotly.relayout(plotDivId, {
                    'shapes[0].x0': newValue,
                    'shapes[0].x1': newValue
                });
            }
        }
    }

    // --- Connect everything ---
    
    // 1. Draw the plots when the page loads
    initializePlots();

    // 2. Add event listeners to all sliders to update the lines
    for (const featureName in plotInputs) {
        const input = plotInputs[featureName];
        if (input) {
            // 'input' event fires continuously as the slider moves
            input.addEventListener('input', updatePlotLines);
        }
    }

    // =================================================================
    // --- 4. AI EXPLANATION PAGE LINK ---
    // =================================================================

    if (analysisButton) {
        analysisButton.addEventListener('click', () => {
            if (!lastPredictionResult) {
                // This shouldn't happen if button is disabled, but as a safeguard
                console.error("No prediction found. Please run a prediction first."); 
                return;
            }

            // 1. Get all form data
            const formData = new FormData(form);
            const params = new URLSearchParams();
            
            formData.forEach((value, key) => {
                params.append(key, value);
            });

            // 2. Add the prediction result to the params
            const predictionText = (lastPredictionResult.prediction === 1) ? "High Risk" : "Low Risk";
            params.append('prediction', predictionText);
            params.append('confidence', (lastPredictionResult.prediction === 1) ? lastPredictionResult.confidence_high_risk : lastPredictionResult.confidence_low_risk);

            // 3. Redirect to the new analysis page with all data in the URL
            // Using an absolute path
            window.location.href = `http://localhost:5000/analysis?${params.toString()}`;
        });
    }

});

