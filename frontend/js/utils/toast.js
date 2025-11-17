// Toast notification system

/**
 * Show toast notification
 * @param {string} type - Toast type: 'success', 'error', 'info', 'warning'
 * @param {string} message - Toast message
 * @param {number} duration - Duration in milliseconds (default: 5000)
 */
export function showToast(type, message, duration = 5000) {
    // Get container - try to find it in the DOM
    let container = document.getElementById('toastContainer');
    
    // If container doesn't exist, create it
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    
    // Ensure container is a valid DOM element
    if (typeof container.appendChild !== 'function') {
        console.error('Toast container is not a valid DOM element:', container);
        return;
    }
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const content = document.createElement('div');
    content.className = 'toast-content';
    content.textContent = message;
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '×';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => dismissToast(toast));
    
    toast.appendChild(content);
    toast.appendChild(closeBtn);
    container.appendChild(toast);
    
    // Auto dismiss
    setTimeout(() => {
        dismissToast(toast);
    }, duration);
}

/**
 * Dismiss toast notification
 */
function dismissToast(toast) {
    toast.classList.add('fade-out');
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
    }, 300);
}

