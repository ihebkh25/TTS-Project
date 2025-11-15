// Tab management utilities

/**
 * Tab configuration
 */
export const tabConfig = {
    tts: { title: 'Text-to-Speech', desc: 'Convert text to natural-sounding speech' },
    stream: { title: 'Real-time Streaming', desc: 'Stream audio in real-time' },
    chat: { title: 'AI Chat', desc: 'Chat with AI assistant' },
    server: { title: 'Server Information', desc: 'Server status and configuration' }
};

/**
 * Setup tab functionality
 */
export function setupTabs(onTabChange = null) {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const pageTitle = document.getElementById('pageTitle');
    const pageDescription = document.getElementById('pageDescription');
    
    // Ensure only the first tab is visible initially
    tabContents.forEach((content, index) => {
        if (index === 0) {
            content.classList.add('active');
            const firstTab = content.getAttribute('data-tab');
            if (firstTab && tabConfig[firstTab]) {
                if (pageTitle) pageTitle.textContent = tabConfig[firstTab].title;
                if (pageDescription) pageDescription.textContent = tabConfig[firstTab].desc;
            }
        } else {
            content.classList.remove('active');
        }
    });
    
    tabButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const targetTab = button.getAttribute('data-tab');
            
            if (!targetTab) return;
            
            // Remove active class from all buttons and contents
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // Find and activate the corresponding content section
            const targetContent = document.querySelector(`.tab-content[data-tab="${targetTab}"]`);
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

