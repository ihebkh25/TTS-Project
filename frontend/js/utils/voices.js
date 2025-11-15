// Voice management utilities

import { formatLanguageName } from './format.js';

/**
 * Populate language select elements
 */
export function populateLanguageSelects(selects, voices, defaultLang = null) {
    selects.forEach(select => {
        if (!select) return;
        const isVoiceMode = select.id === 'voiceModeLanguage';
        
        // Determine default language
        const lang = defaultLang || (voices.includes('en_US') ? 'en_US' : (voices.includes('de_DE') ? 'de_DE' : ''));
        
        if (isVoiceMode) {
            // Voice mode: show default as selected, no "Default" option
            select.innerHTML = '';
        } else {
            select.innerHTML = '<option value="">Select language...</option>';
        }
        
        voices.forEach(voice => {
            const option = document.createElement('option');
            option.value = voice;
            option.textContent = formatLanguageName(voice);
            // Set default language as selected for voice mode
            if (isVoiceMode && voice === lang) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    });
}

