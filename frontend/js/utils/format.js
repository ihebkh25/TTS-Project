// Formatting utility functions

import { LANGUAGE_NAMES, TTS_TO_SPEECH_LANG } from '../config.js';

/**
 * Format language code to readable name
 */
export function formatLanguageName(code) {
    return LANGUAGE_NAMES[code] || code;
}

/**
 * Convert TTS language code to Speech Recognition language code
 */
export function ttsLangToSpeechLang(ttsLang) {
    return TTS_TO_SPEECH_LANG[ttsLang] || 'en-US';
}

/**
 * Format time in seconds to MM:SS format
 */
export function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

