// Server Tab Module - Server information and metrics

import { checkServerHealth, getServerMetrics, getVoices, getVoiceDetails } from '../services/api.js';
import { showStatus, updateServerStatus } from '../utils/dom.js';
import { formatLanguageName } from '../utils/format.js';

/**
 * Initialize Server tab
 * @param {Object} elements - DOM elements
 * @returns {Object} Tab handlers and cleanup functions
 */
export function initServerTab(elements) {
    // Metrics streaming state
    let metricsStreamInterval = null;
    let isStreamingMetrics = false;
    let metricsGrid = null; // Reference to the current metrics grid for updates
    const METRICS_REFRESH_RATE = 500; // Refresh rate in milliseconds (500ms = 0.5 seconds)
    
    // Helper function to get templates
    function getTemplates() {
        const gridTemplate = document.getElementById('metricsGridTemplate');
        const cardTemplate = document.getElementById('metricCardTemplate');
        if (!gridTemplate || !cardTemplate) {
            console.error('Templates not found: metricsGridTemplate or metricCardTemplate');
            return null;
        }
        return { gridTemplate, cardTemplate };
    }
    
    // Helper function to create an error card
    function createErrorCard(message) {
        const templates = getTemplates();
        if (!templates) return null;
        
        const grid = templates.gridTemplate.content.cloneNode(true).querySelector('.metrics-grid');
        const errorCard = templates.cardTemplate.content.cloneNode(true).querySelector('.metric-card');
        errorCard.querySelector('.metric-label').textContent = 'Error';
        const errorValue = errorCard.querySelector('.metric-value');
        errorValue.textContent = 'Failed';
        errorValue.style.color = '#ef4444';
        errorCard.querySelector('.metric-detail').textContent = message;
        grid.appendChild(errorCard);
        
        return grid;
    }
    // Check server status
    async function checkServerStatus() {
        // Stop metrics streaming if active
        stopMetricsStreaming();
        
        console.log('[Server Tab] Checking server status...');
        
        // Clear other displays
        if (elements.serverInfo) {
            elements.serverInfo.innerHTML = '';
        }
        if (elements.serverMetrics) {
            elements.serverMetrics.classList.add('hidden');
            elements.serverMetrics.innerHTML = '';
        }
        
        try {
            // Measure response time
            const startTime = performance.now();
            const healthResponse = await checkServerHealth();
            const endTime = performance.now();
            const responseTimeMs = Math.round(endTime - startTime);
            
            console.log('[Server Tab] Server health check passed:', healthResponse);
            if (elements.serverStatus) {
                updateServerStatus(elements.serverStatus, 'connected', 'Server Connected');
            }
            if (elements.serverInfo) {
                const templates = getTemplates();
                if (!templates) return;
                
                const grid = templates.gridTemplate.content.cloneNode(true).querySelector('.metrics-grid');
                
                // Status card
                const statusCard = templates.cardTemplate.content.cloneNode(true).querySelector('.metric-card');
                statusCard.querySelector('.metric-label').textContent = 'Server Status';
                const statusValue = statusCard.querySelector('.metric-value');
                statusValue.textContent = 'Connected';
                statusValue.style.color = '#10b981';
                statusCard.querySelector('.metric-detail').textContent = 'Server is running and healthy!';
                grid.appendChild(statusCard);
                
                // Response time card
                const timeCard = templates.cardTemplate.content.cloneNode(true).querySelector('.metric-card');
                timeCard.querySelector('.metric-label').textContent = 'Response Time';
                const timeValue = timeCard.querySelector('.metric-value');
                timeValue.textContent = responseTimeMs > 0 ? `${responseTimeMs}ms` : 'N/A';
                timeCard.querySelector('.metric-detail').textContent = 'Health check response';
                grid.appendChild(timeCard);
                
                elements.serverInfo.innerHTML = '';
                elements.serverInfo.appendChild(grid);
            }
        } catch (error) {
            console.error('[Server Tab] Server Status Error:', {
                name: error.name,
                message: error.message,
                stack: error.stack
            });
            if (elements.serverStatus) {
                updateServerStatus(elements.serverStatus, 'disconnected', 'Server Disconnected');
            }
            if (elements.serverInfo) {
                const templates = getTemplates();
                if (!templates) return;
                
                const grid = templates.gridTemplate.content.cloneNode(true).querySelector('.metrics-grid');
                const errorCard = templates.cardTemplate.content.cloneNode(true).querySelector('.metric-card');
                errorCard.querySelector('.metric-label').textContent = 'Server Status';
                const errorValue = errorCard.querySelector('.metric-value');
                errorValue.textContent = 'Disconnected';
                errorValue.style.color = '#ef4444';
                errorCard.querySelector('.metric-detail').textContent = `Server is not responding: ${error.message}`;
                grid.appendChild(errorCard);
                
                elements.serverInfo.innerHTML = '';
                elements.serverInfo.appendChild(grid);
            }
        }
    }
    
    // Update metrics display (for real-time streaming)
    function updateMetricsDisplay(metrics) {
        if (!metricsGrid || !elements.serverMetrics) return;
        
        const cards = metricsGrid.querySelectorAll('.metric-card');
        if (cards.length === 0) return;
        
        // Format uptime
        const uptimeHours = Math.floor(metrics.uptime_seconds / 3600);
        const uptimeMinutes = Math.floor((metrics.uptime_seconds % 3600) / 60);
        const uptimeSeconds = metrics.uptime_seconds % 60;
        const uptimeStr = `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`;
        
        // Format system load
        const loadStr = metrics.system_load 
            ? metrics.system_load.toFixed(2) 
            : 'N/A';
        
        // Update each card based on label
        cards.forEach(card => {
            const label = card.querySelector('.metric-label')?.textContent;
            const valueEl = card.querySelector('.metric-value');
            const detailEl = card.querySelector('.metric-detail');
            const barFill = card.querySelector('.metric-bar-fill');
            
            switch (label) {
                case 'CPU Usage':
                    valueEl.textContent = `${metrics.cpu_usage_percent.toFixed(1)}%`;
                    if (barFill) {
                        const cpuColor = metrics.cpu_usage_percent > 80 ? '#ef4444' : metrics.cpu_usage_percent > 60 ? '#f59e0b' : '#10b981';
                        barFill.style.width = `${Math.min(100, metrics.cpu_usage_percent)}%`;
                        barFill.style.background = cpuColor;
                    }
                    break;
                case 'Memory Usage':
                    valueEl.textContent = `${metrics.memory_usage_percent.toFixed(1)}%`;
                    if (detailEl) {
                        detailEl.textContent = `${metrics.memory_used_mb} MB / ${metrics.memory_total_mb} MB`;
                    }
                    if (barFill) {
                        const memColor = metrics.memory_usage_percent > 80 ? '#ef4444' : metrics.memory_usage_percent > 60 ? '#f59e0b' : '#10b981';
                        barFill.style.width = `${Math.min(100, metrics.memory_usage_percent)}%`;
                        barFill.style.background = memColor;
                    }
                    break;
                case 'Total Requests':
                    valueEl.textContent = metrics.request_count.toLocaleString();
                    break;
                case 'Uptime':
                    valueEl.textContent = uptimeStr;
                    if (detailEl) {
                        detailEl.textContent = `${metrics.uptime_seconds.toLocaleString()} seconds`;
                    }
                    break;
                case 'System Load':
                    valueEl.textContent = loadStr;
                    break;
            }
        });
    }
    
    // Display server metrics
    async function displayServerMetrics(updateOnly = false) {
        // Clear other displays
        if (elements.serverInfo && !updateOnly) {
            elements.serverInfo.innerHTML = '';
        }
        
        // Show metrics container
        if (elements.serverMetrics) {
            elements.serverMetrics.classList.remove('hidden');
        }
        
        try {
            const metrics = await getServerMetrics();
            
            // Format uptime
            const uptimeHours = Math.floor(metrics.uptime_seconds / 3600);
            const uptimeMinutes = Math.floor((metrics.uptime_seconds % 3600) / 60);
            const uptimeSeconds = metrics.uptime_seconds % 60;
            const uptimeStr = `${uptimeHours}h ${uptimeMinutes}m ${uptimeSeconds}s`;
            
            // Format system load
            const loadStr = metrics.system_load 
                ? metrics.system_load.toFixed(2) 
                : 'N/A';
            
            // If updating existing display, just update values
            if (updateOnly && metricsGrid) {
                updateMetricsDisplay(metrics);
                return;
            }
            
            // Create metrics display using templates
            if (!elements.serverMetrics) {
                console.error('serverMetrics element not found');
                return;
            }
            
            const templates = getTemplates();
            if (!templates) return;
            
            const grid = templates.gridTemplate.content.cloneNode(true).querySelector('.metrics-grid');
            metricsGrid = grid; // Store reference for updates
            
            // Helper function to create a metric card
            const createMetricCard = (label, value, detail, showBar = false, barWidth = 0, barColor = '#10b981') => {
                const card = templates.cardTemplate.content.cloneNode(true).querySelector('.metric-card');
                card.querySelector('.metric-label').textContent = label;
                card.querySelector('.metric-value').textContent = value;
                if (detail) {
                    card.querySelector('.metric-detail').textContent = detail;
                }
                if (showBar) {
                    const barContainer = card.querySelector('.metric-bar');
                    barContainer.style.display = 'block';
                    const barFill = barContainer.querySelector('.metric-bar-fill');
                    barFill.style.width = `${Math.min(100, barWidth)}%`;
                    barFill.style.background = barColor;
                }
                return card;
            };
            
            // CPU Usage
            const cpuColor = metrics.cpu_usage_percent > 80 ? '#ef4444' : metrics.cpu_usage_percent > 60 ? '#f59e0b' : '#10b981';
            grid.appendChild(createMetricCard('CPU Usage', `${metrics.cpu_usage_percent.toFixed(1)}%`, null, true, metrics.cpu_usage_percent, cpuColor));
            
            // Memory Usage
            const memColor = metrics.memory_usage_percent > 80 ? '#ef4444' : metrics.memory_usage_percent > 60 ? '#f59e0b' : '#10b981';
            const memCard = createMetricCard('Memory Usage', `${metrics.memory_usage_percent.toFixed(1)}%`, `${metrics.memory_used_mb} MB / ${metrics.memory_total_mb} MB`, true, metrics.memory_usage_percent, memColor);
            grid.appendChild(memCard);
            
            // Total Requests
            grid.appendChild(createMetricCard('Total Requests', metrics.request_count.toLocaleString(), 'Since server start'));
            
            // Uptime
            grid.appendChild(createMetricCard('Uptime', uptimeStr, `${metrics.uptime_seconds.toLocaleString()} seconds`));
            
            // System Load (if available)
            if (metrics.system_load) {
                grid.appendChild(createMetricCard('System Load', loadStr, '1-minute average'));
            }
            
            elements.serverMetrics.innerHTML = '';
            elements.serverMetrics.appendChild(grid);
        } catch (error) {
            console.error('Metrics Error:', error);
            
            // Stop streaming if active
            if (isStreamingMetrics) {
                stopMetricsStreaming();
            }
            
            // Display error in serverMetrics using the same card-based style as other buttons
            if (elements.serverMetrics) {
                elements.serverMetrics.classList.remove('hidden');
                const grid = createErrorCard(`Error fetching metrics: ${error.message}`);
                if (grid) {
                    elements.serverMetrics.innerHTML = '';
                    elements.serverMetrics.appendChild(grid);
                }
            }
            
            // Also clear serverInfo to avoid confusion
            if (elements.serverInfo && !updateOnly) {
                elements.serverInfo.innerHTML = '';
            }
        }
    }
    
    // Stop metrics streaming (helper function)
    function stopMetricsStreaming() {
        if (isStreamingMetrics) {
            if (metricsStreamInterval) {
                clearInterval(metricsStreamInterval);
                metricsStreamInterval = null;
            }
            isStreamingMetrics = false;
            updateMetricsButton(false);
        }
    }
    
    // Start/stop metrics streaming
    function toggleMetricsStreaming() {
        if (isStreamingMetrics) {
            // Stop streaming
            stopMetricsStreaming();
        } else {
            // Start streaming
            // First display metrics
            displayServerMetrics(false);
            
            // Then set up interval to update at configured refresh rate
            metricsStreamInterval = setInterval(() => {
                displayServerMetrics(true); // Update only
            }, METRICS_REFRESH_RATE);
            
            isStreamingMetrics = true;
            updateMetricsButton(true);
        }
    }
    
    // Update metrics button text and state
    function updateMetricsButton(streaming) {
        const button = document.querySelector('button[onclick="getServerMetrics()"]');
        if (button) {
            if (streaming) {
                button.textContent = 'Metrics Streaming';
                button.classList.add('streaming-active');
            } else {
                button.textContent = 'Get Metrics';
                button.classList.remove('streaming-active');
            }
        }
    }
    
    // Display voices list
    async function displayVoices() {
        // Stop metrics streaming if active
        stopMetricsStreaming();
        
        // Clear other displays
        if (elements.serverInfo) {
            elements.serverInfo.innerHTML = '';
        }
        if (elements.serverMetrics) {
            elements.serverMetrics.classList.add('hidden');
            elements.serverMetrics.innerHTML = '';
        }
        
        try {
            const voicesList = await getVoices();
            if (elements.serverInfo) {
                const templates = getTemplates();
                if (!templates) return;
                
                const grid = templates.gridTemplate.content.cloneNode(true).querySelector('.metrics-grid');
                
                voicesList.forEach(voice => {
                    const card = templates.cardTemplate.content.cloneNode(true).querySelector('.metric-card');
                    card.querySelector('.metric-label').textContent = 'Voice';
                    card.querySelector('.metric-value').textContent = formatLanguageName(voice);
                    card.querySelector('.metric-detail').textContent = voice;
                    grid.appendChild(card);
                });
                
                elements.serverInfo.innerHTML = '';
                elements.serverInfo.appendChild(grid);
            }
        } catch (error) {
            console.error('Voices Error:', error);
            if (elements.serverInfo) {
                const grid = createErrorCard(`Error fetching voices: ${error.message}`);
                if (grid) {
                    elements.serverInfo.innerHTML = '';
                    elements.serverInfo.appendChild(grid);
                }
            }
        }
    }
    
    // Display voice details
    async function displayVoiceDetails() {
        // Stop metrics streaming if active
        stopMetricsStreaming();
        
        // Clear other displays
        if (elements.serverInfo) {
            elements.serverInfo.innerHTML = '';
        }
        if (elements.serverMetrics) {
            elements.serverMetrics.classList.add('hidden');
            elements.serverMetrics.innerHTML = '';
        }
        
        try {
            const details = await getVoiceDetails();
            if (elements.serverInfo) {
                const templates = getTemplates();
                if (!templates) return;
                
                const grid = templates.gridTemplate.content.cloneNode(true).querySelector('.metrics-grid');
                
                details.forEach(v => {
                    const card = templates.cardTemplate.content.cloneNode(true).querySelector('.metric-card');
                    card.querySelector('.metric-label').textContent = 'Voice';
                    card.querySelector('.metric-value').textContent = formatLanguageName(v.key);
                    const detailEl = card.querySelector('.metric-detail');
                    detailEl.innerHTML = `<strong>Code:</strong> ${v.key}<br><strong>Config:</strong> ${v.config}<br><strong>Speaker:</strong> ${v.speaker !== null ? v.speaker : 'Default'}`;
                    grid.appendChild(card);
                });
                
                elements.serverInfo.innerHTML = '';
                elements.serverInfo.appendChild(grid);
            }
        } catch (error) {
            console.error('Voice Details Error:', error);
            if (elements.serverInfo) {
                const grid = createErrorCard(`Error fetching voice details: ${error.message}`);
                if (grid) {
                    elements.serverInfo.innerHTML = '';
                    elements.serverInfo.appendChild(grid);
                }
            }
        }
    }
    
    // Set up event listeners for HTML onclick handlers
    function setupEventListeners() {
        // These functions are exposed to window for HTML onclick handlers
        window.checkServerStatus = checkServerStatus;
        window.getServerMetrics = toggleMetricsStreaming;
        window.getVoices = displayVoices;
        window.getVoicesDetail = displayVoiceDetails;
    }
    
    // Cleanup function to stop streaming when tab is closed
    function cleanup() {
        stopMetricsStreaming();
        metricsGrid = null;
    }
    
    // Initialize
    setupEventListeners();
    
    // Don't check server status here - it's already checked in main.js
    // Only check when tab is activated or when explicitly requested
    
    return {
        checkServerStatus,
        displayServerMetrics,
        displayVoices,
        displayVoiceDetails,
        cleanup
    };
}

