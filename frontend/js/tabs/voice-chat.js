// Voice Mode Tab - Round microphone with real-time oscillations
import { showToast } from '../utils/toast.js';
import { showStatus } from '../utils/dom.js';
import { sendVoiceChatMessage, generateTTS } from '../services/api.js';
import { 
    requestMicrophoneAccess, 
    isSpeechRecognitionSupported, 
    createSpeechRecognition,
    calculateAudioLevel
} from '../services/voice.js';
import { ttsLangToSpeechLang } from '../utils/format.js';
import { visualizeAudioSpectrogram } from '../components/spectrogram.js';
import { CONFIG } from '../config.js';
import { populateVoiceSelect, parseVoiceKey, getDefaultVoiceForLanguage } from '../utils/voices.js';

const DEFAULT_LANGUAGE = 'en_US';

export function initVoiceChatTab(elements, state) {
    const { voiceDetails = [] } = state;
    const micBtn = elements.voiceChatMicBtn;
    const micStatus = elements.voiceChatMicStatus;
    const micCanvas = elements.voiceChatMicCanvas;
    const botCanvas = elements.voiceChatBotCanvas;
    const botSpecCanvas = elements.voiceBotSpectrogram;
    const statusEl = elements.voiceChatStatus;
    const voiceSelect = elements.voiceChatVoice;
    const transcriptContainer = elements.voiceTranscriptContainer;
    const transcriptText = elements.voiceTranscriptText;
    const convoLog = elements.voiceConversationLog;
    
    // Populate voice select when voiceDetails are available
    function populateVoiceDropdown() {
        if (!voiceSelect || !voiceDetails || voiceDetails.length === 0) return;
        populateVoiceSelect(voiceSelect, voiceDetails, DEFAULT_LANGUAGE);
    }
    
    // Populate voice dropdown on initialization if voiceDetails are already loaded
    if (voiceDetails && voiceDetails.length > 0) {
        populateVoiceDropdown();
    }
    
    if (!micBtn || !micCanvas || !botCanvas) {
        console.warn('[VoiceChat] Missing UI elements');
        return;
    }
    
    const micCtx = micCanvas.getContext('2d');
    const botCtx = botCanvas.getContext('2d');
    
    function resizeCanvases() {
        // Mic canvas is square inside container
        const rect = micCanvas.parentElement.getBoundingClientRect();
        micCanvas.width = rect.width;
        micCanvas.height = rect.height;
        // Bot canvas fills container
        const botRect = botCanvas.parentElement.getBoundingClientRect();
        botCanvas.width = botRect.width;
        botCanvas.height = botRect.height;
        if (botSpecCanvas) {
            botSpecCanvas.width = botRect.width;
            botSpecCanvas.height = botRect.height;
        }
    }
    resizeCanvases();
    window.addEventListener('resize', resizeCanvases);
    
    const stateVoice = {
        isRecording: false,
        mediaStream: null,
        audioContext: null,
        analyser: null,
        dataArray: null,
        animationFrame: null,
        speechRecognition: null,
        transcript: '',
        selectedLanguage: DEFAULT_LANGUAGE,
        selectedVoice: null, // Full voice key (e.g., "en_US:norman")
        botAudioContext: null,
        botAnalyser: null,
        botDataArray: null,
        botAudio: null,
        // Silence detection
        lastVoiceTime: null,
        hasDetectedSpeech: false,
        wordReveal: {
            active: false,
            words: [],
            targetEl: null,
            fullText: ''
        }
    };
    
    // Update selected language and voice when voice select changes
    if (voiceSelect) {
        voiceSelect.addEventListener('change', () => {
            const voiceKey = voiceSelect.value;
            if (voiceKey) {
                const { lang, voice } = parseVoiceKey(voiceKey);
                stateVoice.selectedLanguage = lang;
                stateVoice.selectedVoice = voiceKey;
                if (stateVoice.isRecording) {
                    if (stateVoice.speechRecognition) {
                        try { stateVoice.speechRecognition.stop(); } catch {}
                        stateVoice.speechRecognition = null;
                        // Restart with new language
                        const sr = createSpeechRecognition();
                        if (sr) {
                            sr.lang = ttsLangToSpeechLang(stateVoice.selectedLanguage);
                            sr.onresult = (e) => {
                                let final = '';
                                let interim = '';
                                for (let i = e.resultIndex; i < e.results.length; i++) {
                                    const transcript = e.results[i][0].transcript;
                                    if (e.results[i].isFinal) {
                                        final += transcript + ' ';
                                    } else {
                                        interim += transcript;
                                    }
                                }
                                stateVoice.transcript = (final + interim).trim();
                            };
                            sr.onerror = (e) => {
                                console.warn('[VoiceChat] SR error:', e.error);
                            };
                            sr.onend = () => {
                                if (stateVoice.isRecording) {
                                    sr.start();
                                }
                            };
                            stateVoice.speechRecognition = sr;
                            sr.start();
                        }
                    }
                }
                showToast('info', `Voice Mode voice: ${voiceSelect.options[voiceSelect.selectedIndex].text}`);
            }
        });
    }
    function normalizeReplyText(text) {
        if (!text) return '';
        let t = text;
        // Replace URLs with 'link'
        t = t.replace(/https?:\/\/\S+/gi, ' link ');
        // Strip markdown/code fences and backticks
        t = t.replace(/```[\s\S]*?```/g, ' ');
        t = t.replace(/`[^`]*`/g, ' ');
        // Remove common emoji/variation selectors but keep international letters
        t = t.replace(/[\uFE0F\u200D]/g, ' '); // variation selectors / ZWJ
        // Remove obvious emoji surrogates without touching letters with diacritics
        t = t.replace(/[\uD83C-\uDBFF][\uDC00-\uDFFF]/g, ' ');
        // Remove bullet markers and stray math/code symbols that cause literal pronunciation
        // e.g., asterisks, underscores, pipes, carets, tildes
        t = t.replace(/[*_|\^~]+/g, ' ');
        // Remove standalone symbol tokens (non-alnum between spaces) while preserving punctuation like .,!?;:
        t = t.replace(/\s[\/\\@#%=+><]{1,2}\s/g, ' ');
        // Normalize list markers at line starts (e.g., "- ", "* ", "• ")
        t = t.replace(/(^|\n)\s*[-*•]\s+/g, '$1');
        // Replace repeated punctuation
        t = t.replace(/[!?]{2,}/g, match => match[0]);
        t = t.replace(/\.{3,}/g, '...');
        // Add spaces around symbols that can cause stutter
        t = t.replace(/([#@&$%*=+\-_/\\])/g, ' $1 ');
        // Remove bracketed artifacts (e.g. [REF], (link))
        t = t.replace(/\[[^\]]*\]/g, ' ');
        t = t.replace(/\([^\)]*\)/g, ' ');
        // Normalize quotes/dashes
        t = t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-');
        // Collapse whitespace
        t = t.replace(/\s+/g, ' ').trim();
        // Remove stray period inserted before capitalized word for short determiners (e.g., "The. Goblin")
        t = t.replace(/\b(The|A|An|Le|La|Les|Die|Der|Das|El|Lo)\.\s+(?=[A-Z])/g, '$1 ');
        // More generic: word (1-4 letters) followed by ". " then capitalized next word -> drop the period
        t = t.replace(/\b([A-Z][a-z]{0,3})\.\s+([A-Z])/g, '$1 $2');
        // Also normalize accidental " . " to ". " (if any slipped in)
        t = t.replace(/\s+\.\s+/g, '. ');
        // Guard against super short outputs
        if (t.length < 3) t = text;
        return t;
    }

    
    function updateTranscriptUI(interim = '') {
        if (!transcriptText) return;
        const interimSuffix = interim ? ` ${interim}` : '';
        transcriptText.textContent = (stateVoice.transcript + interimSuffix).trim();
        if (transcriptContainer) {
            transcriptContainer.style.display = (stateVoice.isRecording || transcriptText.textContent) ? 'block' : 'none';
            transcriptContainer.classList.toggle('recording', !!stateVoice.isRecording);
        }
    }
    
    // Draw circular/radial oscillations on mic canvas
    function drawMicOscillations() {
        if (!stateVoice.isRecording || !stateVoice.analyser || !stateVoice.dataArray) {
            micCtx.clearRect(0, 0, micCanvas.width, micCanvas.height);
            return;
        }
        stateVoice.analyser.getByteFrequencyData(stateVoice.dataArray);
        
        // Silence detection using audio level
        const audioLevel = calculateAudioLevel(stateVoice.analyser, stateVoice.dataArray);
        const now = Date.now();
        const vadCfg = CONFIG?.VAD || { SILENCE_THRESHOLD: 20, SILENCE_DURATION: 1000, MIN_RECORDING_DURATION: 500 };
        const threshold = vadCfg.SILENCE_THRESHOLD;
        const minRecord = vadCfg.MIN_RECORDING_DURATION || 500;
        const maxSilence = 1000; // 1s as per requirement
        if (audioLevel > threshold) {
            stateVoice.hasDetectedSpeech = true;
            stateVoice.lastVoiceTime = now;
        } else if (stateVoice.hasDetectedSpeech && stateVoice.lastVoiceTime && (now - stateVoice.lastVoiceTime) >= Math.max(maxSilence, vadCfg.SILENCE_DURATION || 1000)) {
            // Auto stop after 1s of silence
            stopRecording();
        }
        
        const { width, height } = micCanvas;
        const cx = width / 2;
        const cy = height / 2;
        const radius = Math.min(width, height) * 0.32;
        
        micCtx.clearRect(0, 0, width, height);
        
        const bars = 64;
        for (let i = 0; i < bars; i++) {
            const t = Math.floor((i / bars) * stateVoice.dataArray.length);
            const v = stateVoice.dataArray[t] / 255;
            const angle = (i / bars) * Math.PI * 2;
            const barLen = radius * 0.6 * v + radius * 0.1;
            const x1 = cx + Math.cos(angle) * radius;
            const y1 = cy + Math.sin(angle) * radius;
            const x2 = cx + Math.cos(angle) * (radius + barLen);
            const y2 = cy + Math.sin(angle) * (radius + barLen);
            
            const hue = 240 - v * 180;
            micCtx.strokeStyle = `hsla(${hue}, 100%, ${30 + v * 50}%, 0.9)`;
            micCtx.lineWidth = 3;
            micCtx.lineCap = 'round';
            micCtx.beginPath();
            micCtx.moveTo(x1, y1);
            micCtx.lineTo(x2, y2);
            micCtx.stroke();
        }
    }
    
    function drawBotOscillations() {
        if (!stateVoice.botAnalyser || !stateVoice.botDataArray) {
            botCtx.clearRect(0, 0, botCanvas.width, botCanvas.height);
            return;
        }
        stateVoice.botAnalyser.getByteFrequencyData(stateVoice.botDataArray);
        const { width, height } = botCanvas;
        botCtx.clearRect(0, 0, width, height);
        
        const bars = Math.min(128, stateVoice.botDataArray.length);
        const barWidth = width / bars;
        for (let i = 0; i < bars; i++) {
            const v = stateVoice.botDataArray[i] / 255;
            const barHeight = v * height * 0.9;
            const x = i * barWidth;
            const y = height - barHeight;
            const hue = 200 - v * 100;
            const grad = botCtx.createLinearGradient(x, y, x, height);
            grad.addColorStop(0, `hsl(${hue}, 100%, ${50 + v * 30}%)`);
            grad.addColorStop(1, `hsl(${hue}, 100%, ${20 + v * 10}%)`);
            botCtx.fillStyle = grad;
            botCtx.fillRect(x + 1, y, barWidth - 2, barHeight);
        }
    }
    
    function startMicVisualization() {
        function loop() {
            drawMicOscillations();
            drawBotOscillations();
            stateVoice.animationFrame = requestAnimationFrame(loop);
        }
        if (!stateVoice.animationFrame) {
            stateVoice.animationFrame = requestAnimationFrame(loop);
        }
    }
    
    function stopMicVisualization() {
        if (stateVoice.animationFrame) {
            cancelAnimationFrame(stateVoice.animationFrame);
            stateVoice.animationFrame = null;
        }
        micCtx.clearRect(0, 0, micCanvas.width, micCanvas.height);
    }
    
    function setMicStatus(text, recording = false) {
        if (micStatus) {
            micStatus.textContent = text;
        }
        if (recording) {
            micBtn.classList.add('recording');
        } else {
            micBtn.classList.remove('recording');
        }
    }
    
    async function startRecording() {
        if (stateVoice.isRecording) return;
        // Get selected voice or use default
        const voiceKey = voiceSelect?.value;
        if (voiceKey) {
            const { lang, voice } = parseVoiceKey(voiceKey);
            stateVoice.selectedLanguage = lang;
            stateVoice.selectedVoice = voiceKey;
        } else {
            // Fallback: find default voice for default language
            const defaultVoice = getDefaultVoiceForLanguage(DEFAULT_LANGUAGE, voiceDetails);
            if (defaultVoice) {
                stateVoice.selectedLanguage = DEFAULT_LANGUAGE;
                stateVoice.selectedVoice = defaultVoice.key;
            } else {
                stateVoice.selectedLanguage = DEFAULT_LANGUAGE;
                stateVoice.selectedVoice = null;
            }
        }
        try {
            const stream = await requestMicrophoneAccess({
                onError: (err) => {
                    showToast('error', `Microphone error: ${err.message}`);
                }
            });
            if (!stream) return;
            stateVoice.mediaStream = stream;
            stateVoice.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = stateVoice.audioContext.createMediaStreamSource(stream);
            stateVoice.analyser = stateVoice.audioContext.createAnalyser();
            stateVoice.analyser.fftSize = 256;
            stateVoice.analyser.smoothingTimeConstant = 0.8;
            stateVoice.dataArray = new Uint8Array(stateVoice.analyser.frequencyBinCount);
            source.connect(stateVoice.analyser);
            stateVoice.isRecording = true;
            stateVoice.hasDetectedSpeech = false;
            stateVoice.lastVoiceTime = null;
            // Speech recognition
            if (isSpeechRecognitionSupported()) {
                stateVoice.transcript = '';
                const sr = createSpeechRecognition({
                    continuous: true,
                    interimResults: true,
                    lang: ttsLangToSpeechLang(stateVoice.selectedLanguage)
                });
                sr.onresult = (e) => {
                    let interim = '';
                    let final = '';
                    for (let i = e.resultIndex; i < e.results.length; i++) {
                        const t = e.results[i][0].transcript;
                        if (e.results[i].isFinal) final += t + ' ';
                        else interim += t;
                    }
                    stateVoice.transcript = (final + interim).trim();
                    updateTranscriptUI(interim);
                };
                sr.onerror = (e) => {
                    console.warn('[VoiceChat] SR error:', e.error);
                };
                sr.onend = () => {
                    if (stateVoice.isRecording) {
                        try { sr.start(); } catch {}
                    }
                };
                stateVoice.speechRecognition = sr;
                try { sr.start(); } catch {}
            }
            setMicStatus('Listening...', true);
            startMicVisualization();
            showToast('success', 'Recording started');
            updateTranscriptUI('');
        } catch (err) {
            showToast('error', `Failed to start: ${err.message}`);
            setMicStatus('Click to start', false);
        }
    }
    
    function stopRecording() {
        if (!stateVoice.isRecording) return;
        stateVoice.isRecording = false;
        if (stateVoice.speechRecognition) {
            try { stateVoice.speechRecognition.stop(); } catch {}
            stateVoice.speechRecognition = null;
        }
        if (stateVoice.mediaStream) {
            stateVoice.mediaStream.getTracks().forEach(t => t.stop());
            stateVoice.mediaStream = null;
        }
        if (stateVoice.audioContext) {
            try { stateVoice.audioContext.close(); } catch {}
            stateVoice.audioContext = null;
        }
        stateVoice.analyser = null;
        stateVoice.dataArray = null;
        stopMicVisualization();
        setMicStatus('Processing...', false);
        const finalTranscript = stateVoice.transcript.trim();
        stateVoice.transcript = '';
        if (finalTranscript) {
            sendMessage(finalTranscript);
        } else {
            setMicStatus('Click to start', false);
            showToast('info', 'No speech detected');
        }
        updateTranscriptUI('');
    }
    
    async function sendMessage(text) {
        try {
            showStatus(statusEl, 'info', 'Sending...');
            appendConversationMessage('user', text);
            // Language adherence hint to the LLM
            const langNames = {
                en_US: 'English',
                fr_FR: 'Français',
                de_DE: 'Deutsch',
                es_ES: 'Español',
                nl_NL: 'Nederlands'
            };
            const langName = langNames[stateVoice.selectedLanguage] || stateVoice.selectedLanguage;
            const instruction = `Please respond strictly in ${langName} only.`;
            const guidedText = `${instruction}\n${text}`;
            // Parse voice to get just the voice ID (not the full key)
            const voiceId = stateVoice.selectedVoice ? parseVoiceKey(stateVoice.selectedVoice).voice : null;
            const data = await sendVoiceChatMessage(guidedText, stateVoice.selectedLanguage, state.currentConversationId, voiceId);
            if (state.setCurrentConversationId) {
                state.setCurrentConversationId(data.conversation_id);
            } else {
                state.currentConversationId = data.conversation_id;
            }
            // Prepare filtered reply text
            const replyText = data.reply || '';
            const filteredReply = normalizeReplyText(replyText);
            // If available, re-synthesize with filtered text for smoother speech
            let audioBase64 = null;
            try {
                // Parse voice to get just the voice ID (not the full key)
                const voiceId = stateVoice.selectedVoice ? parseVoiceKey(stateVoice.selectedVoice).voice : null;
                const ttsData = await generateTTS(filteredReply || replyText, stateVoice.selectedLanguage, null, voiceId);
                audioBase64 = ttsData?.audio_base64 || null;
            } catch (e) {
                console.warn('[VoiceChat] Fallback to server audio due to TTS error:', e);
                audioBase64 = data.audio_base64 || null;
            }
            if (audioBase64) {
                const audio = new Audio();
                audio.src = `data:audio/wav;base64,${audioBase64}`;
                stateVoice.botAudio = audio;
                // Word-by-word reveal
                let assistantMsgEl = null;
                const revealText = filteredReply || replyText;
                if (revealText) {
                    assistantMsgEl = appendConversationMessage('assistant', '');
                    setupWordReveal(assistantMsgEl, revealText, audio);
                }
                audio.play().catch(err => console.warn('Audio play error:', err));
                if (botSpecCanvas) {
                    try {
                        visualizeAudioSpectrogram(botSpecCanvas, audio);
                    } catch (e) {
                        console.warn('[VoiceChat] Spectrogram init failed:', e);
                    }
                }
            } else if (filteredReply) {
                appendConversationMessage('assistant', filteredReply);
            }
            showStatus(statusEl, 'success', 'Message sent');
        } catch (err) {
            showStatus(statusEl, 'error', `Error: ${err.message}`);
        } finally {
            setMicStatus('Click to start', false);
        }
    }

    function appendConversationMessage(role, text) {
        if (!convoLog) return null;
        const wrapper = document.createElement('div');
        wrapper.style.display = 'flex';
        wrapper.style.justifyContent = role === 'user' ? 'flex-end' : 'flex-start';
        const bubble = document.createElement('div');
        bubble.style.maxWidth = '85%';
        bubble.style.padding = '0.5rem 0.75rem';
        bubble.style.borderRadius = '0.5rem';
        bubble.style.lineHeight = '1.6';
        bubble.style.fontSize = '0.95rem';
        bubble.style.whiteSpace = 'pre-wrap';
        bubble.style.wordBreak = 'break-word';
        if (role === 'user') {
            bubble.style.background = 'var(--surface)';
            bubble.style.border = '1px solid var(--border-lighter)';
        } else {
            bubble.style.background = 'var(--surface-light)';
            bubble.style.border = '1px solid var(--border-light)';
        }
        bubble.textContent = text;
        wrapper.appendChild(bubble);
        convoLog.appendChild(wrapper);
        convoLog.scrollTop = convoLog.scrollHeight;
        return bubble;
    }

    function setupWordReveal(targetEl, text, audio) {
        if (!targetEl || !audio) return;
        const words = text.split(/\s+/);
        if (words.length === 0) return;
        stateVoice.wordReveal.active = true;
        stateVoice.wordReveal.words = words;
        stateVoice.wordReveal.targetEl = targetEl;
        stateVoice.wordReveal.fullText = text;
        const updateReveal = () => {
            if (!stateVoice.wordReveal.active) return;
            const dur = Math.max(audio.duration || 1, 1);
            const progress = Math.min(Math.max(audio.currentTime / dur, 0), 1);
            const idx = Math.max(1, Math.floor(progress * words.length));
            const shown = words.slice(0, idx).join(' ');
            targetEl.textContent = shown;
        };
        const endReveal = () => {
            stateVoice.wordReveal.active = false;
            targetEl.textContent = text;
            cleanup();
        };
        const cleanup = () => {
            audio.removeEventListener('timeupdate', updateReveal);
            audio.removeEventListener('ended', endReveal);
            audio.removeEventListener('pause', updateReveal);
            audio.removeEventListener('seeking', updateReveal);
        };
        audio.addEventListener('timeupdate', updateReveal);
        audio.addEventListener('pause', updateReveal);
        audio.addEventListener('seeking', updateReveal);
        audio.addEventListener('ended', endReveal, { once: true });
        // Initial render
        updateReveal();
    }
    
    function onMicClick() {
        // If assistant is speaking, finalize text and stop audio
        if (stateVoice.botAudio && !stateVoice.botAudio.paused) {
            try {
                stateVoice.botAudio.pause();
                stateVoice.botAudio.currentTime = 0;
            } catch {}
            if (stateVoice.wordReveal?.active && stateVoice.wordReveal.targetEl) {
                stateVoice.wordReveal.targetEl.textContent = stateVoice.wordReveal.fullText || stateVoice.wordReveal.words.join(' ');
                stateVoice.wordReveal.active = false;
            }
            if (stateVoice.botAudio._spectrogramCleanup) {
                try { stateVoice.botAudio._spectrogramCleanup(); } catch {}
                stateVoice.botAudio._spectrogramCleanup = null;
            }
            try {
                if (stateVoice.botAnalyser) stateVoice.botAnalyser.disconnect();
            } catch {}
        }
        if (stateVoice.isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    }

    // Voice select change handler is already set up above (lines 94-138)
    
    micBtn.addEventListener('click', onMicClick);
    
    return {
        populateVoiceDropdown,
        cleanup: () => {
            window.removeEventListener('resize', resizeCanvases);
            if (stateVoice.isRecording) stopRecording();
            stopMicVisualization();
            if (stateVoice.botAudio) {
                try { stateVoice.botAudio.pause(); } catch {}
                stateVoice.botAudio = null;
            }
            if (stateVoice.botAudioContext) {
                try { stateVoice.botAudioContext.close(); } catch {}
                stateVoice.botAudioContext = null;
            }
        }
    };
}


