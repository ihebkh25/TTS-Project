// Server Tab Module - Server information and metrics

import { CONFIG } from '../config.js';
import { checkServerHealth, getServerMetrics, getVoices, getVoiceDetails } from '../services/api.js';
import { showStatus, updateServerStatus } from '../utils/dom.js';
import { formatLanguageName } from '../utils/format.js';

/**
 * Initialize Server tab
 * @param {Object} elements - DOM elements
 * @returns {Object} Tab handlers and cleanup functions
 */
export function initServerTab(elements) {
    // Check server status
    async function checkServerStatus() {
        console.log('[Server Tab] Checking server status...');
        try {
            const healthResponse = await checkServerHealth();
            console.log('[Server Tab] Server health check passed:', healthResponse);
            if (elements.serverStatus) {
                updateServerStatus(elements.serverStatus, 'connected', 'Server Connected');
            }
            if (elements.serverInfo) {
                showStatus(elements.serverInfo, 'success', 'Server is running and healthy!');
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
                showStatus(elements.serverInfo, 'error', `Server is not responding: ${error.message}`);
            }
        }
    }
    
    // Display server metrics
    async function displayServerMetrics() {
        if (elements.serverMetrics) {
            elements.serverMetrics.classList.remove('hidden');
        }
        if (elements.serverInfo) {
            showStatus(elements.serverInfo, 'info', 'Fetching server metrics...');
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
            
            // Create metrics display
            const metricsHtml = `
                <div class="metrics-grid">
                    <div class="metric-card">
                        <div class="metric-label">CPU Usage</div>
                        <div class="metric-value">${metrics.cpu_usage_percent.toFixed(1)}%</div>
                        <div class="metric-bar">
                            <div class="metric-bar-fill" style="width: ${Math.min(100, metrics.cpu_usage_percent)}%; background: ${metrics.cpu_usage_percent > 80 ? '#ef4444' : metrics.cpu_usage_percent > 60 ? '#f59e0b' : '#10b981'};"></div>
                        </div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Memory Usage</div>
                        <div class="metric-value">${metrics.memory_usage_percent.toFixed(1)}%</div>
                        <div class="metric-detail">${metrics.memory_used_mb} MB / ${metrics.memory_total_mb} MB</div>
                        <div class="metric-bar">
                            <div class="metric-bar-fill" style="width: ${Math.min(100, metrics.memory_usage_percent)}%; background: ${metrics.memory_usage_percent > 80 ? '#ef4444' : metrics.memory_usage_percent > 60 ? '#f59e0b' : '#10b981'};"></div>
                        </div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Total Requests</div>
                        <div class="metric-value">${metrics.request_count.toLocaleString()}</div>
                        <div class="metric-detail">Since server start</div>
                    </div>
                    <div class="metric-card">
                        <div class="metric-label">Uptime</div>
                        <div class="metric-value">${uptimeStr}</div>
                        <div class="metric-detail">${metrics.uptime_seconds.toLocaleString()} seconds</div>
                    </div>
                    ${metrics.system_load ? `
                    <div class="metric-card">
                        <div class="metric-label">System Load</div>
                        <div class="metric-value">${loadStr}</div>
                        <div class="metric-detail">1-minute average</div>
                    </div>
                    ` : ''}
                </div>
            `;
            
            if (elements.serverMetrics) {
                elements.serverMetrics.innerHTML = metricsHtml;
            }
            
            if (elements.serverInfo) {
                showStatus(elements.serverInfo, 'success', 'Server metrics retrieved successfully!');
            }
        } catch (error) {
            console.error('Metrics Error:', error);
            if (elements.serverInfo) {
                showStatus(elements.serverInfo, 'error', `Error fetching metrics: ${error.message}`);
            }
            if (elements.serverMetrics) {
                elements.serverMetrics.classList.add('hidden');
            }
        }
    }
    
    // Display voices list
    async function displayVoices() {
        if (elements.serverInfo) {
            showStatus(elements.serverInfo, 'info', 'Fetching voices...');
        }
        
        try {
            const voicesList = await getVoices();
            if (elements.serverInfo) {
                showStatus(elements.serverInfo, 'success', 
                    `Available voices:<br>
                     ${voicesList.map(voice => `• ${formatLanguageName(voice)} (${voice})`).join('<br>')}`);
            }
        } catch (error) {
            console.error('Voices Error:', error);
            if (elements.serverInfo) {
                showStatus(elements.serverInfo, 'error', `Error fetching voices: ${error.message}`);
            }
        }
    }
    
    // Display voice details
    async function displayVoiceDetails() {
        if (elements.serverInfo) {
            showStatus(elements.serverInfo, 'info', 'Fetching voice details...');
        }
        
        try {
            const details = await getVoiceDetails();
            const detailsHtml = details.map(v => 
                `• <strong>${formatLanguageName(v.key)}</strong> (${v.key})<br>
                 &nbsp;&nbsp;Config: ${v.config}<br>
                 &nbsp;&nbsp;Speaker: ${v.speaker !== null ? v.speaker : 'Default'}`
            ).join('<br><br>');
            
            if (elements.serverInfo) {
                showStatus(elements.serverInfo, 'success', 
                    `Voice details:<br><br>${detailsHtml}`);
            }
        } catch (error) {
            console.error('Voice Details Error:', error);
            if (elements.serverInfo) {
                showStatus(elements.serverInfo, 'error', `Error fetching voice details: ${error.message}`);
            }
        }
    }
    
    // Set up event listeners for HTML onclick handlers
    function setupEventListeners() {
        // These functions are exposed to window for HTML onclick handlers
        window.checkServerStatus = checkServerStatus;
        window.getServerMetrics = displayServerMetrics;
        window.getVoices = displayVoices;
        window.getVoicesDetail = displayVoiceDetails;
    }
    
    // Initialize
    setupEventListeners();
    
    // Don't check server status here - it's already checked in main.js
    // Only check when tab is activated or when explicitly requested
    
    return {
        checkServerStatus,
        displayServerMetrics,
        displayVoices,
        displayVoiceDetails
    };
}

