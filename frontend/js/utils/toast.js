// Toast notification system

/**
 * Show toast notification
 */
export function showToast(container, type, message, duration = 5000) {
    if (!container) return;
    
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

