// Voice management utilities

import { formatLanguageName } from './format.js';

/**
 * Parse voice key in format "lang:voice" or legacy "lang"
 */
export function parseVoiceKey(key) {
    if (key.includes(':')) {
        const [lang, voice] = key.split(':', 2);
        return { lang, voice };
    }
    return { lang: key, voice: null };
}

/**
 * Group voice details by language
 */
export function groupVoicesByLanguage(voiceDetails) {
    const grouped = {};
    
    voiceDetails.forEach(voice => {
        const { lang } = parseVoiceKey(voice.key);
        if (!grouped[lang]) {
            grouped[lang] = [];
        }
        grouped[lang].push(voice);
    });
    
    return grouped;
}

/**
 * Get default voice for a language from voice details
 */
export function getDefaultVoiceForLanguage(lang, voiceDetails) {
    // Find voices for this language
    const langVoices = voiceDetails.filter(v => {
        const { lang: vLang } = parseVoiceKey(v.key);
        return vLang === lang;
    });
    
    if (langVoices.length === 0) return null;
    
    // Try to find a voice with "default" in the name, or just use the first one
    const defaultVoice = langVoices.find(v => {
        const { voice } = parseVoiceKey(v.key);
        return voice && (voice.toLowerCase().includes('default') || voice.toLowerCase().includes('norman') || voice.toLowerCase().includes('thorsten'));
    });
    
    return defaultVoice || langVoices[0];
}

/**
 * Populate language select elements (for backward compatibility and simple language selection)
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
 * Populate voice select dropdown with voices grouped by language
 */
export function populateVoiceSelect(voiceSelect, voiceDetails, defaultLang = null, defaultVoice = null) {
    if (!voiceSelect || !voiceDetails || voiceDetails.length === 0) return;
    
    // Group voices by language
    const grouped = groupVoicesByLanguage(voiceDetails);
    const languages = Object.keys(grouped).sort();
    
    // Clear existing options
    voiceSelect.innerHTML = '<option value="">Select voice...</option>';
    
    // Determine default
    const lang = defaultLang || (languages.includes('en_US') ? 'en_US' : (languages.includes('de_DE') ? 'de_DE' : languages[0]));
    
    languages.forEach(langCode => {
        const langVoices = grouped[langCode];
        const langName = formatLanguageName(langCode);
        
        // Create optgroup for language
        const optgroup = document.createElement('optgroup');
        optgroup.label = langName;
        
        langVoices.forEach(voiceDetail => {
            const { voice } = parseVoiceKey(voiceDetail.key);
            const displayName = voiceDetail.display_name || voice || 'Default';
            
            // Build voice label - show premium indicator for high quality
            let label = displayName;
            if (voiceDetail.quality === 'high') {
                label += ' [Premium]';
            }
            
            const option = document.createElement('option');
            option.value = voiceDetail.key; // Use full key "lang:voice"
            option.textContent = label;
            
            // Set as selected if it's the default
            if (defaultVoice && voiceDetail.key === defaultVoice) {
                option.selected = true;
            } else if (!defaultVoice && langCode === lang && langVoices.indexOf(voiceDetail) === 0) {
                // First voice of default language
                option.selected = true;
            }
            
            optgroup.appendChild(option);
        });
        
        voiceSelect.appendChild(optgroup);
    });
}

/**
 * Populate voice select for a specific language only
 */
export function populateVoiceSelectForLanguage(voiceSelect, lang, voiceDetails, defaultVoice = null) {
    if (!voiceSelect || !lang || !voiceDetails) return;
    
    // Filter voices for this language
    const langVoices = voiceDetails.filter(v => {
        const { lang: vLang } = parseVoiceKey(v.key);
        return vLang === lang;
    });
    
    if (langVoices.length === 0) {
        voiceSelect.innerHTML = '<option value="">No voices available</option>';
        return;
    }
    
    // Clear existing options
    voiceSelect.innerHTML = '<option value="">Select voice...</option>';
    
    langVoices.forEach(voiceDetail => {
        const { voice } = parseVoiceKey(voiceDetail.key);
        const displayName = voiceDetail.display_name || voice || 'Default';
        
        // Build voice label - show premium indicator for high quality
        let label = displayName;
        if (voiceDetail.quality === 'high') {
            label += ' [Premium]';
        }
        
        const option = document.createElement('option');
        option.value = voiceDetail.key; // Use full key "lang:voice"
        option.textContent = label;
        
        // Set as selected if it's the default
        if (defaultVoice && voiceDetail.key === defaultVoice) {
            option.selected = true;
        } else if (!defaultVoice && langVoices.indexOf(voiceDetail) === 0) {
            // First voice
            option.selected = true;
        }
        
        voiceSelect.appendChild(option);
    });
}

/**
 * Populate speaker select for a given language (legacy support)
 * @deprecated Use populateVoiceSelect instead
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

