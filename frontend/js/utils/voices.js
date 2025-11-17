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

/**
 * Populate speaker select for a given language
 */
export function populateSpeakerSelect(speakerSelect, language, voiceDetails) {
    if (!speakerSelect || !language || !voiceDetails) return;
    
    const voiceDetail = voiceDetails.find(v => v.key === language);
    if (!voiceDetail || voiceDetail.speaker === null) {
        speakerSelect.innerHTML = '<option value="">Default</option>';
        return;
    }
    
    // Clear existing options
    speakerSelect.innerHTML = '<option value="">Default</option>';
    
    // Add speaker options (assuming speaker is a number indicating number of speakers)
    const numSpeakers = typeof voiceDetail.speaker === 'number' ? voiceDetail.speaker : 1;
    for (let i = 0; i < numSpeakers; i++) {
        const option = document.createElement('option');
        option.value = i.toString();
        option.textContent = `Speaker ${i + 1}`;
        speakerSelect.appendChild(option);
    }
}

