// Tab management utilities

/**
 * Tab configuration
 */
export const tabConfig = {
    tts: { title: 'Text-to-Speech', desc: 'Convert text to natural-sounding speech', file: 'tabs/tts.html' },
    stream: { title: 'Real-time Streaming', desc: 'Stream audio in real-time', file: 'tabs/stream.html' },
    chat: { title: 'AI Chat', desc: 'Chat with AI assistant', file: 'tabs/chat.html' },
    server: { title: 'Server Information', desc: 'Server status and configuration', file: 'tabs/server.html' }
};

// Cache for loaded tabs
const loadedTabs = new Map();

/**
 * Load a tab HTML file
 */
async function loadTabHTML(tabName) {
    if (loadedTabs.has(tabName)) {
        return loadedTabs.get(tabName);
    }
    
    const config = tabConfig[tabName];
    if (!config || !config.file) {
        throw new Error(`Tab configuration not found for: ${tabName}`);
    }
    
    try {
        const response = await fetch(config.file);
        if (!response.ok) {
            throw new Error(`Failed to load tab: ${response.statusText}`);
        }
        const html = await response.text();
        loadedTabs.set(tabName, html);
        return html;
    } catch (error) {
        console.error(`Error loading tab ${tabName}:`, error);
        throw error;
    }
}

/**
 * Load and insert tab content
 */
async function loadTabContent(tabName, container) {
    // Check if tab is already loaded in DOM
    let tabElement = container.querySelector(`.tab-content[data-tab="${tabName}"]`);
    if (tabElement) {
        return tabElement;
    }
    
    try {
        const html = await loadTabHTML(tabName);
        
        // Create a temporary container to parse the HTML
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;
        const newTabElement = tempDiv.querySelector(`.tab-content[data-tab="${tabName}"]`);
        
        if (newTabElement) {
            // Append to container (don't replace all content)
            container.appendChild(newTabElement);
            return newTabElement;
        } else {
            throw new Error('Tab element not found in loaded HTML');
        }
    } catch (error) {
        console.error(`Error loading tab content for ${tabName}:`, error);
        const errorDiv = document.createElement('div');
        errorDiv.className = 'tab-content';
        errorDiv.setAttribute('data-tab', tabName);
        errorDiv.innerHTML = `<p>Error loading tab: ${error.message}</p>`;
        container.appendChild(errorDiv);
        return errorDiv;
    }
}

/**
 * Setup tab functionality
 */
export async function setupTabs(onTabChange = null) {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContentContainer = document.getElementById('tabContentContainer');
    const pageTitle = document.getElementById('pageTitle');
    const pageDescription = document.getElementById('pageDescription');
    
    if (!tabContentContainer) {
        console.error('Tab content container not found');
        return;
    }
    
    // Load initial tab (tts)
    const initialTab = 'tts';
    const initialButton = document.querySelector(`.tab-btn[data-tab="${initialTab}"]`);
    if (initialButton) {
        initialButton.classList.add('active');
    }
    
    await loadTabContent(initialTab, tabContentContainer);
    
    // Update page title and description for initial tab
    if (tabConfig[initialTab]) {
        if (pageTitle) pageTitle.textContent = tabConfig[initialTab].title;
        if (pageDescription) pageDescription.textContent = tabConfig[initialTab].desc;
    }
    
    // Activate initial tab
    const initialContent = tabContentContainer.querySelector(`.tab-content[data-tab="${initialTab}"]`);
    if (initialContent) {
        initialContent.classList.add('active');
    }
    
    // Setup tab button click handlers
    tabButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            const targetTab = button.getAttribute('data-tab');
            
            if (!targetTab) return;
            
            // Remove active class from all buttons
            tabButtons.forEach(btn => btn.classList.remove('active'));
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // Check if tab is already loaded
            let targetContent = tabContentContainer.querySelector(`.tab-content[data-tab="${targetTab}"]`);
            
            if (!targetContent) {
                // Load the tab content
                targetContent = await loadTabContent(targetTab, tabContentContainer);
            }
            
            // Hide all tabs
            const allTabs = tabContentContainer.querySelectorAll('.tab-content');
            allTabs.forEach(tab => tab.classList.remove('active'));
            
            // Show target tab
            if (targetContent) {
                targetContent.classList.add('active');
                
                // Update page title and description
                if (tabConfig[targetTab]) {
                    if (pageTitle) pageTitle.textContent = tabConfig[targetTab].title;
                    if (pageDescription) pageDescription.textContent = tabConfig[targetTab].desc;
                }
                
                // Call tab change callback
                if (onTabChange) {
                    onTabChange(targetTab, targetContent);
                }
            }
        });
    });
}

