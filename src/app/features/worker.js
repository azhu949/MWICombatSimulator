// Auto-generated from src/main.js (Worker)

function onWorkerMessage(event) {
    switch (event.data.type) {
        case "simulation_result":
            progressbar.style.width = "100%";
            progressbar.innerHTML = "100% (" + ((Date.now() - simStartTime) / 1000).toFixed(2) + "s)";
            window.lastSimulationResult = event.data.simResult;
            console.log("[MWI_SIM_RESULT_OBJECT]", event.data.simResult);
            console.log("[MWI_SIM_RESULT_JSON]", JSON.stringify(event.data.simResult));
            showSimulationResult(event.data.simResult);
            updateContent();
            buttonStartSimulation.disabled = false;
            buttonStopSimulation.style.display = 'none';
            document.getElementById('buttonShowAllSimData').style.display = 'none';
            break;
        case "simulation_progress":
            let progress = Math.floor(100 * event.data.progress);
            progressbar.style.width = progress + "%";
            progressbar.innerHTML = progress + "% (" + ((Date.now() - simStartTime) / 1000).toFixed(2) + "s)";
            // 实时更新图表
            if (event.data.timeSeriesData && document.getElementById('hpMpVisualizationToggle').checked) {
                updateChartsRealtime(event.data.timeSeriesData);
            }
            break;
        case "simulation_error":
            showErrorModal(event.data.error.toString());
            break;
    }
}

function onMultiWorkerMessage(event) {
    switch (event.data.type) {
        case "simulation_result_allZones":
        case "simulation_result_allLabyrinths":
            progressbar.style.width = "100%";
            progressbar.innerHTML = "100% (" + ((Date.now() - simStartTime) / 1000).toFixed(2) + "s)";
            window.lastAllZonesSimulationResults = event.data.simResults;
            if (event.data.type === "simulation_result_allZones") {
                console.log("[MWI_SIM_ALL_ZONES_OBJECT]", event.data.simResults);
                console.log("[MWI_SIM_ALL_ZONES_JSON]", JSON.stringify(event.data.simResults));
            } else {
                console.log("[MWI_SIM_ALL_LABYRINTHS_OBJECT]", event.data.simResults);
                console.log("[MWI_SIM_ALL_LABYRINTHS_JSON]", JSON.stringify(event.data.simResults));
            }
            showAllSimulationResults(event.data.simResults);
            updateContent();
            buttonStartSimulation.disabled = false;
            buttonStopSimulation.style.display = 'none';
            document.getElementById('buttonShowAllSimData').style.display = 'block';
            break;
        case "simulation_progress":
            let progress = Math.floor(100 * event.data.progress);
            progressbar.style.width = progress + "%";
            progressbar.innerHTML = progress + "% (" + ((Date.now() - simStartTime) / 1000).toFixed(2) + "s)";
            break;
        case "simulation_error":
            showErrorModal(event.data.error.toString());
            break;
    }
}

export function registerWorkerModule(api) {
    api.registerFunctions({
        onWorkerMessage,
        onMultiWorkerMessage
    });
}
