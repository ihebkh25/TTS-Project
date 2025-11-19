mod wav;
mod melspec;

use std::{collections::HashMap, fs, path::Path, sync::{Arc, RwLock}, hash::{Hash, Hasher}, time::Instant};

use anyhow::Context;
use base64::Engine; // for STANDARD.encode()
use hound;
use image::{ImageBuffer, Luma};
use mel_spec::prelude::*;
use ndarray::Array1;
use num_complex::Complex;
//use piper_rs::PiperError;
use serde::{Deserialize, Serialize};
use piper_rs::synth::{PiperSpeechStreamParallel, PiperSpeechSynthesizer};
use dashmap::DashMap;
use lru::LruCache;
use tokio::sync::RwLock as TokioRwLock;
use tokio::time::Duration;
use ahash::AHasher;


#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapEntry {
    pub config: String,
    pub default_speaker: Option<i64>,
}

// Cached synthesizer and sample rate
struct CachedSynth {
    synth: Arc<RwLock<PiperSpeechSynthesizer>>, // Changed from Mutex to RwLock for parallel reads
    sample_rate: u32,
    last_accessed: Instant, // Track access time for LRU
}

// Manual Debug implementation since PiperSpeechSynthesizer doesn't implement Debug
impl std::fmt::Debug for CachedSynth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CachedSynth")
            .field("synth", &"<PiperSpeechSynthesizer>")
            .field("sample_rate", &self.sample_rate)
            .field("last_accessed", &self.last_accessed)
            .finish()
    }
}

// Cached audio response
#[derive(Clone)]
struct CachedResponse {
    audio_base64: String,
    sample_rate: u32,
    duration_ms: u64,
    cached_at: Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceEntry {
    pub config: String,
    pub speaker_id: Option<i64>,
    pub display_name: Option<String>,
    pub gender: Option<String>,
    pub quality: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TtsManager {
    // language key -> (default voice, voices map)
    // For backwards compatibility: language key -> (config path, default speaker)
    pub(crate) map: HashMap<String, (String, Option<i64>)>,
    // New format: language -> (default_voice_id, voices_map)
    pub(crate) voices_map: HashMap<String, (String, HashMap<String, VoiceEntry>)>,
    // Cache: config path -> (synthesizer, sample_rate)
    // Using DashMap for concurrent access without blocking
    cache: Arc<DashMap<String, CachedSynth>>,
    // LRU cache wrapper to limit cache size
    max_cache_size: usize,
    // Response cache: (text + language + voice) -> CachedResponse
    // Using TokioRwLock for async access
    response_cache: Arc<TokioRwLock<LruCache<u64, CachedResponse>>>,
    response_cache_ttl: Duration,
}

impl TtsManager {
    /// Create from a prebuilt map
    pub fn new(map: HashMap<String, (String, Option<i64>)>) -> Self {
        Self { 
            map,
            voices_map: HashMap::new(),
            cache: Arc::new(DashMap::new()),
            max_cache_size: 15, // Increased: cache up to 15 models (better for multi-language scenarios)
            response_cache: Arc::new(TokioRwLock::new(LruCache::new(std::num::NonZeroUsize::new(500).unwrap()))), // Increased: 500 entries for better hit rate
            response_cache_ttl: Duration::from_secs(3600), // 1 hour TTL
        }
    }
    
    /// Create with custom cache size limit
    pub fn new_with_cache_size(map: HashMap<String, (String, Option<i64>)>, max_cache_size: usize) -> Self {
        Self {
            map,
            voices_map: HashMap::new(),
            cache: Arc::new(DashMap::new()),
            max_cache_size,
            response_cache: Arc::new(TokioRwLock::new(LruCache::new(std::num::NonZeroUsize::new(500).unwrap()))), // Increased: 500 entries
            response_cache_ttl: Duration::from_secs(3600), // 1 hour TTL
        }
    }

    /// Load from `models/map.json`
    /// Supports both new format (with multiple voices) and legacy format
    pub fn new_from_mapfile<P: AsRef<Path>>(p: P) -> anyhow::Result<Self> {
        let text = fs::read_to_string(p.as_ref())
            .with_context(|| format!("Failed to load {}", p.as_ref().display()))?;
        let json: serde_json::Value = serde_json::from_str(&text)
            .with_context(|| "map.json is not valid JSON")?;

        let mut map: HashMap<String, (String, Option<i64>)> = HashMap::new();
        let mut voices_map: HashMap<String, (String, HashMap<String, VoiceEntry>)> = HashMap::new();

        if let Some(obj) = json.as_object() {
            for (lang, v) in obj {
                // Check if this is the new format with "voices" key
                if let serde_json::Value::Object(o) = v {
                    if o.contains_key("voices") {
                        // New format: { "default_voice": "...", "voices": {...} }
                        let default_voice = o
                            .get("default_voice")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing 'default_voice' for language {}", lang))?
                            .to_string();
                        
                        let voices_obj = o
                            .get("voices")
                            .and_then(|x| x.as_object())
                            .ok_or_else(|| anyhow::anyhow!("missing 'voices' object for language {}", lang))?;
                        
                        let mut voices: HashMap<String, VoiceEntry> = HashMap::new();
                        for (voice_id, voice_data) in voices_obj {
                            if let serde_json::Value::Object(vo) = voice_data {
                                let config = vo
                                    .get("config")
                                    .and_then(|x| x.as_str())
                                    .ok_or_else(|| anyhow::anyhow!("missing 'config' for voice {}", voice_id))?
                                    .to_string();
                                
                                let speaker_id = vo.get("speaker_id").and_then(|x| x.as_i64());
                                let voice_entry = VoiceEntry {
                                    config: config.clone(),
                                    speaker_id,
                                    display_name: vo.get("display_name").and_then(|x| x.as_str()).map(|s| s.to_string()),
                                    gender: vo.get("gender").and_then(|x| x.as_str()).map(|s| s.to_string()),
                                    quality: vo.get("quality").and_then(|x| x.as_str()).map(|s| s.to_string()),
                                };
                                
                                voices.insert(voice_id.clone(), voice_entry);
                                
                                // Also populate legacy map with default voice for backwards compatibility
                                if voice_id == &default_voice {
                                    map.insert(lang.clone(), (config, speaker_id));
                                }
                            }
                        }
                        
                        voices_map.insert(lang.clone(), (default_voice, voices));
                        continue;
                    }
                }
                
                // Legacy format handling
                match v {
                    serde_json::Value::String(path) => {
                        map.insert(lang.clone(), (path.clone(), None));
                    }
                    serde_json::Value::Object(o) => {
                        let config = o
                            .get("config")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing 'config' for key {}", lang))?
                            .to_string();
                        let spk = o.get("default_speaker").and_then(|x| x.as_i64());
                        map.insert(lang.clone(), (config, spk));
                    }
                    _ => {
                        return Err(anyhow::anyhow!(
                            "invalid entry for key {} (expected string or object)",
                            lang
                        ));
                    }
                }
            }
        } else {
            return Err(anyhow::anyhow!("map.json must be a JSON object"));
        }

        Ok(Self { 
            map,
            voices_map,
            cache: Arc::new(DashMap::new()),
            max_cache_size: 15, // Increased: cache up to 15 models
            response_cache: Arc::new(TokioRwLock::new(LruCache::new(std::num::NonZeroUsize::new(500).unwrap()))), // Increased: 500 entries
            response_cache_ttl: Duration::from_secs(3600), // 1 hour TTL
        })
    }

    /// List supported language keys
    pub fn list_languages(&self) -> Vec<String> {
        // Combine languages from both maps
        let mut langs: Vec<String> = self.map.keys().cloned().collect();
        for lang in self.voices_map.keys() {
            if !langs.contains(lang) {
                langs.push(lang.clone());
            }
        }
        langs.sort();
        langs
    }

    /// Iterate raw mapping (for /voices/detail)
    pub fn map_iter(&self) -> impl Iterator<Item = (&String, &(String, Option<i64>))> {
        self.map.iter()
    }

    /// Resolve config (and default speaker) for a language key
    /// If voice_opt is provided, uses that voice; otherwise uses default voice
    pub fn config_for(&self, lang_opt: Option<&str>, voice_opt: Option<&str>) -> anyhow::Result<(String, Option<i64>)> {
        let lang = lang_opt.unwrap_or("de_DE");
        
        // Try new format first
        if let Some((default_voice, voices)) = self.voices_map.get(lang) {
            let voice_id = voice_opt.unwrap_or(default_voice);
            if let Some(voice_entry) = voices.get(voice_id) {
                return Ok((voice_entry.config.clone(), voice_entry.speaker_id));
            }
            return Err(anyhow::anyhow!(
                "Unknown voice '{}' for language '{}'. Available voices: {}",
                voice_id,
                lang,
                voices.keys().cloned().collect::<Vec<_>>().join(", ")
            ));
        }
        
        // Fall back to legacy format
        self.map
            .get(lang)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!(format!("Unknown language key: {lang}. Use /voices to list.")))
    }
    
    /// List all voices for a language
    pub fn list_voices_for_language(&self, lang: &str) -> Vec<(String, VoiceEntry)> {
        if let Some((_, voices)) = self.voices_map.get(lang) {
            voices.iter().map(|(id, entry)| (id.clone(), entry.clone())).collect()
        } else {
            Vec::new()
        }
    }
    
    /// Get default voice for a language
    pub fn get_default_voice(&self, lang: &str) -> Option<String> {
        self.voices_map.get(lang).map(|(default, _)| default.clone())
    }

    /// Read sample rate from model config JSON
    fn read_sample_rate<P: AsRef<Path>>(cfg_path: P) -> anyhow::Result<u32> {
        let text = fs::read_to_string(cfg_path.as_ref())
            .with_context(|| format!("Failed to read config file: {}", cfg_path.as_ref().display()))?;
        let json: serde_json::Value = serde_json::from_str(&text)
            .with_context(|| "Config file is not valid JSON")?;
        
        let sample_rate = json
            .get("audio")
            .and_then(|a| a.get("sample_rate"))
            .and_then(|sr| sr.as_u64())
            .ok_or_else(|| anyhow::anyhow!("Missing or invalid 'audio.sample_rate' in config"))?;
        
        Ok(sample_rate as u32)
    }

    /// Get or create a cached synthesizer for a config path
    pub fn get_or_create_synth<P: AsRef<Path>>(
        &self,
        cfg_path: P,
    ) -> anyhow::Result<(Arc<RwLock<PiperSpeechSynthesizer>>, u32)> {
        let cfg_path_str = cfg_path.as_ref().to_string_lossy().to_string();
        
        // Check cache first (DashMap allows concurrent reads without blocking)
        if let Some(mut cached) = self.cache.get_mut(&cfg_path_str) {
            cached.last_accessed = Instant::now();
            return Ok((cached.synth.clone(), cached.sample_rate));
        }
        
        // Not in cache, load it
        let sample_rate = Self::read_sample_rate(&cfg_path)?;
        let model = piper_rs::from_config_path(cfg_path.as_ref())
            .map_err(|e| anyhow::anyhow!("piper load error: {e}"))?;
        let synth = PiperSpeechSynthesizer::new(model)?;
        
        // Cache it with LRU eviction if needed
        let synth_arc = Arc::new(RwLock::new(synth));
        let cached = CachedSynth { 
            synth: synth_arc.clone(), 
            sample_rate,
            last_accessed: Instant::now(),
        };
        
        // If cache is full, remove least recently used entry (optimized LRU)
        if self.cache.len() >= self.max_cache_size {
            // Optimized: use iterator with early exit and avoid unnecessary clones
            let mut oldest_key: Option<String> = None;
            let mut oldest_time = Instant::now();
            
            // Find least recently used entry (single pass, O(n) but optimized)
            for entry in self.cache.iter() {
                let access_time = entry.last_accessed;
                if access_time < oldest_time {
                    oldest_time = access_time;
                    // Only clone when we find a candidate (reduces allocations)
                    oldest_key = Some(entry.key().clone());
                }
            }
            
            if let Some(key) = oldest_key {
                self.cache.remove(&key);
            }
        }
        
        self.cache.insert(cfg_path_str, cached);
        
        Ok((synth_arc, sample_rate))
    }

    /// Build a Piper synthesizer from a config path (legacy method, now uses cache)
    /// Note: This creates a new synthesizer each time for compatibility.
    /// For better performance, use get_or_create_synth directly.
    pub fn build_synth<P: AsRef<Path>>(
        &self,
        cfg_path: P,
    ) -> anyhow::Result<PiperSpeechSynthesizer> {
        // For legacy compatibility, we still create a new one
        // but at least we cache the sample rate
        let model = piper_rs::from_config_path(cfg_path.as_ref())
            .map_err(|e| anyhow::anyhow!("piper load error: {e}"))?;
        Ok(PiperSpeechSynthesizer::new(model)?)
    }
    
    /// Get sample rate for a config path (uses cache)
    pub fn get_sample_rate<P: AsRef<Path>>(&self, cfg_path: P) -> anyhow::Result<u32> {
        let cfg_path_str = cfg_path.as_ref().to_string_lossy().to_string();
        
        // Check cache for sample rate (concurrent read, no blocking)
        if let Some(cached) = self.cache.get(&cfg_path_str) {
            return Ok(cached.sample_rate);
        }
        
        // Load and cache (reuse get_or_create_synth logic)
        let (_, sample_rate) = self.get_or_create_synth(&cfg_path)?;
        Ok(sample_rate)
    }

    /// Generate cache key for response cache using faster ahash
    fn cache_key(text: &str, lang_opt: Option<&str>, voice_opt: Option<&str>) -> u64 {
        let mut hasher = AHasher::default();
        text.hash(&mut hasher);
        lang_opt.hash(&mut hasher);
        voice_opt.hash(&mut hasher);
        hasher.finish()
    }

    /// Legacy helper kept for compatibility (uses default speaker)
    pub fn synthesize_blocking(&self, text: &str, lang_opt: Option<&str>) -> anyhow::Result<Vec<f32>> {
        self.synthesize_with(text, lang_opt, None, None)
    }

    /// New: allow an optional speaker override and voice selection
    pub fn synthesize_with(
        &self,
        text: &str,
        lang_opt: Option<&str>,
        _speaker_override: Option<i64>, // kept for future use
        voice_opt: Option<&str>, // voice ID (e.g., "norman", "thorsten")
    ) -> anyhow::Result<Vec<f32>> {
        let (cfg_path, _default_speaker) = self.config_for(lang_opt, voice_opt)?;

        // Get or create cached synthesizer
        let (synth_arc, _) = self.get_or_create_synth(&cfg_path)?;
        // Use map_err to handle lock poisoning gracefully instead of panicking
        let synth = synth_arc.read()
            .map_err(|_| anyhow::anyhow!("Synthesizer lock poisoned - this indicates a previous panic. Please restart the server."))?;

        // In your piper-rs version, pass None (no public speaker selection)
        let iter: PiperSpeechStreamParallel = synth
            .synthesize_parallel(text.to_string(), None)
            .map_err(|e| anyhow::anyhow!("piper synth error: {e}"))?;

        let mut samples: Vec<f32> = Vec::new();
        for part in iter {
            samples.extend(
                part.map_err(|e| anyhow::anyhow!("chunk error: {e}"))?
                    .into_vec(),
            );
        }
        Ok(samples)
    }

    
    /// Synthesize with speaker and return samples along with sample rate
    pub fn synthesize_with_sample_rate(
        &self,
        text: &str,
        lang_opt: Option<&str>,
        _speaker_override: Option<i64>, // kept for future use
        voice_opt: Option<&str>, // voice ID (e.g., "norman", "thorsten")
    ) -> anyhow::Result<(Vec<f32>, u32)> {
        // Use enhanced synthesis with pauses for more natural speech
        self.synthesize_with_pauses(text, lang_opt, voice_opt)
    }

    /// Synthesize text with natural pauses at commas and sentence endings
    /// Splits text at punctuation, synthesizes chunks separately, and inserts silence
    fn synthesize_with_pauses(
        &self,
        text: &str,
        lang_opt: Option<&str>,
        voice_opt: Option<&str>,
    ) -> anyhow::Result<(Vec<f32>, u32)> {
        let (cfg_path, _default_speaker) = self.config_for(lang_opt, voice_opt)?;
        let sample_rate = self.get_sample_rate(&cfg_path)?;
        let (synth_arc, _) = self.get_or_create_synth(&cfg_path)?;
        let synth = synth_arc.read()
            .map_err(|_| anyhow::anyhow!("Synthesizer lock poisoned - this indicates a previous panic. Please restart the server."))?;

        // Split text into chunks at punctuation for natural pauses
        let chunks = Self::split_text_with_pauses(text);
        
        if chunks.is_empty() {
            return Ok((Vec::new(), sample_rate));
        }

        let mut all_samples: Vec<f32> = Vec::new();
        
        // Synthesize each chunk separately and add pauses between them
        for (i, chunk) in chunks.iter().enumerate() {
            let chunk = chunk.trim();
            if chunk.is_empty() {
                continue;
            }

            // Synthesize this chunk
            let iter: PiperSpeechStreamParallel = synth
                .synthesize_parallel(chunk.to_string(), None)
                .map_err(|e| anyhow::anyhow!("piper synth error: {e}"))?;

            let mut chunk_samples: Vec<f32> = Vec::new();
            for part in iter {
                chunk_samples.extend(
                    part.map_err(|e| anyhow::anyhow!("chunk error: {e}"))?
                        .into_vec(),
                );
            }

            // Add chunk audio
            all_samples.extend(chunk_samples);

            // Add pause after chunk (except for the last chunk)
            if i < chunks.len() - 1 {
                let pause_duration_ms = Self::get_pause_duration(&chunks[i]);
                let pause_samples = (pause_duration_ms as f32 / 1000.0 * sample_rate as f32) as usize;
                all_samples.extend(vec![0.0; pause_samples]);
            }
        }

        Ok((all_samples, sample_rate))
    }

    /// Split text into chunks at punctuation marks for natural pauses
    fn split_text_with_pauses(text: &str) -> Vec<String> {
        let mut chunks = Vec::new();
        let mut current_chunk = String::new();
        let chars: Vec<char> = text.chars().collect();
        
        let mut i = 0;
        while i < chars.len() {
            current_chunk.push(chars[i]);
            
            // Check if this is a punctuation mark that should trigger a pause
            match chars[i] {
                // Sentence endings: longer pause
                '.' | '!' | '?' => {
                    // Check if this is an abbreviation (e.g., "Dr.", "Mr.", "etc.")
                    let is_abbrev = if i >= 2 && i + 1 < chars.len() && chars[i + 1] != ' ' {
                        let start = i.saturating_sub(3);
                        let end = (i + 1).min(chars.len());
                        let context: String = chars[start..end].iter().collect();
                        context.ends_with("Dr.") || context.ends_with("Mr.") || 
                        context.ends_with("Mrs.") || context.ends_with("Ms.") ||
                        context.ends_with("Prof.") || context.ends_with("etc.") ||
                        context.ends_with("vs.") || context.ends_with("e.g.") ||
                        context.ends_with("i.e.") || context.ends_with("a.m.") ||
                        context.ends_with("p.m.") || context.ends_with("Inc.") ||
                        context.ends_with("Ltd.") || context.ends_with("Corp.")
                    } else {
                        false
                    };
                    
                    if !is_abbrev {
                        // Include following space if present
                        if i + 1 < chars.len() && chars[i + 1] == ' ' {
                            current_chunk.push(chars[i + 1]);
                            i += 1;
                        }
                        chunks.push(current_chunk.clone());
                        current_chunk.clear();
                    }
                }
                // Commas: short pause
                // Skip commas in numbers (e.g., "1,000" or "3,14" for European decimal)
                ',' => {
                    // Check if comma is in a number context (digit before and after)
                    let is_number_comma = if i > 0 && i + 1 < chars.len() {
                        let prev_char = chars[i - 1];
                        let next_char = chars[i + 1];
                        (prev_char.is_ascii_digit() && next_char.is_ascii_digit()) ||
                        (prev_char.is_whitespace() && i > 1 && chars[i - 2].is_ascii_digit())
                    } else {
                        false
                    };
                    
                    if !is_number_comma {
                        // Include following space if present
                        if i + 1 < chars.len() && chars[i + 1] == ' ' {
                            current_chunk.push(chars[i + 1]);
                            i += 1;
                        }
                        chunks.push(current_chunk.clone());
                        current_chunk.clear();
                    }
                }
                // Semicolons and colons: medium pause
                ';' | ':' => {
                    // Include following space if present
                    if i + 1 < chars.len() && chars[i + 1] == ' ' {
                        current_chunk.push(chars[i + 1]);
                        i += 1;
                    }
                    chunks.push(current_chunk.clone());
                    current_chunk.clear();
                }
                _ => {}
            }
            
            i += 1;
        }
        
        // Add remaining chunk
        if !current_chunk.trim().is_empty() {
            chunks.push(current_chunk);
        }
        
        // If no punctuation found, return original text as single chunk
        if chunks.is_empty() {
            chunks.push(text.to_string());
        }
        
        chunks
    }

    /// Get pause duration in milliseconds based on the chunk's ending punctuation
    fn get_pause_duration(chunk: &str) -> u32 {
        let trimmed = chunk.trim_end();
        if trimmed.ends_with('.') || trimmed.ends_with('!') || trimmed.ends_with('?') {
            // Sentence endings: 300-500ms pause
            400
        } else if trimmed.ends_with(';') || trimmed.ends_with(':') {
            // Semicolons and colons: 200-300ms pause
            250
        } else if trimmed.ends_with(',') {
            // Commas: 100-200ms pause
            150
        } else {
            // Default: 100ms
            100
        }
    }

    /// Synthesize with caching - async version for response cache
    pub async fn synthesize_with_cache(
        &self,
        text: &str,
        lang_opt: Option<&str>,
        voice_opt: Option<&str>,
    ) -> anyhow::Result<(String, u32, u64, bool)> {
        // Check response cache first
        let cache_key = Self::cache_key(text, lang_opt, voice_opt);
        {
            let cache = self.response_cache.read().await;
            if let Some(cached) = cache.peek(&cache_key) {
                // Check if cache entry is still valid (not expired)
                if Instant::now().duration_since(cached.cached_at) < self.response_cache_ttl {
                    return Ok((
                        cached.audio_base64.clone(),
                        cached.sample_rate,
                        cached.duration_ms,
                        true, // cache hit
                    ));
                }
            }
        }

        // Cache miss - synthesize and encode in a single blocking task (reduces overhead)
        // Clone only the data we need, not the entire manager with async types
        let text = text.to_string();
        let lang_opt = lang_opt.map(|s| s.to_string());
        let voice_opt = voice_opt.map(|s| s.to_string());
        
        // Clone the manager's data structures needed for synthesis
        let map = self.map.clone();
        let voices_map = self.voices_map.clone();
        let cache = Arc::clone(&self.cache);
        let max_cache_size = self.max_cache_size;
        
        // Combined blocking task: synthesize + encode in one go (faster, less overhead)
        let (audio_base64, sample_rate, duration_ms) = tokio::task::spawn_blocking(move || {
            // Create a temporary manager for blocking synthesis
            // This avoids cloning async types (TokioRwLock)
            let temp_manager = TtsManager {
                map,
                voices_map,
                cache,
                max_cache_size,
                response_cache: Arc::new(TokioRwLock::new(LruCache::new(std::num::NonZeroUsize::new(1).unwrap()))), // Dummy cache, not used
                response_cache_ttl: Duration::from_secs(3600), // Dummy, not used
            };
            
            // Synthesize audio
            let (samples, sample_rate) = temp_manager.synthesize_with_sample_rate(
                &text,
                lang_opt.as_deref(),
                None,
                voice_opt.as_deref()
            )?;
            
            // Calculate duration
            let sample_rate_f32 = sample_rate as f32;
            let duration_ms = (samples.len() as f32 / sample_rate_f32 * 1000.0) as u64;
            
            // Encode to WAV base64 (in same task, no extra cloning needed)
            let audio_base64 = Self::encode_wav_base64(&samples, sample_rate)?;
            
            Ok::<(String, u32, u64), anyhow::Error>((audio_base64, sample_rate, duration_ms))
        })
        .await
        .map_err(|e| anyhow::anyhow!("Task join error: {e}"))?
        .map_err(|e| anyhow::anyhow!("Synthesis/encoding error: {e}"))?;

        // Cache the result
        let cached_response = CachedResponse {
            audio_base64: audio_base64.clone(),
            sample_rate,
            duration_ms,
            cached_at: Instant::now(),
        };

        {
            let mut cache = self.response_cache.write().await;
            cache.put(cache_key, cached_response);
        }

        Ok((audio_base64, sample_rate, duration_ms, false)) // cache miss
    }

    /// Preload frequently used models
    pub fn preload_models(&self, languages: &[&str]) -> anyhow::Result<()> {
        for lang in languages {
            if let Ok((cfg_path, _)) = self.config_for(Some(lang), None) {
                let _ = self.get_or_create_synth(&cfg_path)?;
            }
        }
        Ok(())
    }


    /// Convenience: WAV base64 (optimized with pre-allocated buffer)
    pub fn encode_wav_base64(samples: &[f32], sample_rate: u32) -> anyhow::Result<String> {
        use std::io::Cursor;
        use base64::Engine; // enables `.encode(...)`

        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        // Pre-allocate buffer: WAV header (44 bytes) + samples (2 bytes per sample)
        // This reduces reallocations during writing
        let estimated_size = 44 + (samples.len() * 2);
        let mut cursor = Cursor::new(Vec::<u8>::with_capacity(estimated_size));
        
        {
            let mut writer = hound::WavWriter::new(&mut cursor, spec)
                .map_err(|e| anyhow::anyhow!("wav write err: {e}"))?;

            // Optimized: batch write samples (hound handles buffering internally)
            // Pre-compute conversion constants for better performance
            const I16_MAX_F32: f32 = i16::MAX as f32;
            
            for &s in samples {
                // Clamp and convert f32 [-1.0, 1.0] -> i16
                // Using clamp is clear and optimized by the compiler
                let v = (s.clamp(-1.0, 1.0) * I16_MAX_F32) as i16;
                writer
                    .write_sample(v)
                    .map_err(|e| anyhow::anyhow!("wav sample err: {e}"))?;
            }
            // `writer` drops here, which finalizes the WAV header/footer
        }

        let buf = cursor.into_inner();
        Ok(base64::engine::general_purpose::STANDARD.encode(buf))
    }


    /// Compute mel spectrogram from audio
    pub fn audio_to_mel(
        samples: &[f32],
        sample_rate: f32,
        frame_size: usize,
        hop_size: usize,
        n_mels: usize,
    ) -> Vec<Vec<f64>> {
        let mut stft = Spectrogram::new(frame_size, hop_size);
        let mut mel = MelSpectrogram::new(frame_size, sample_rate as f64, n_mels);

        let mut frames: Vec<Vec<f64>> = Vec::new();
        let mut offset = 0usize;
        while offset + hop_size <= samples.len() {
            let slice = &samples[offset..offset + hop_size];

            let mel_frame: Vec<f64> = if let Some(fft_frame) = stft.add(slice) {
                let arr_f64: Array1<Complex<f64>> = Array1::from_iter(
                    fft_frame.into_iter().map(|c: Complex<f64>| c),
                );
                let (flat, _off) = mel.add(&arr_f64).into_raw_vec_and_offset();
                flat
            } else {
                vec![0.0f64; n_mels]
            };

            frames.push(mel_frame);
            offset += hop_size;
        }

        frames
    }

    /// Render mel spectrogram (simple grayscale) to base64 PNG
    pub fn mel_to_png_base64(mel: &[Vec<f64>]) -> String {
        if mel.is_empty() {
            return String::new();
        }
        let height = mel[0].len() as u32;
        let width = mel.len() as u32;

        // Normalize values per-frame for visibility
        let mut img = ImageBuffer::<Luma<u8>, Vec<u8>>::new(width, height);
        for (x, frame) in mel.iter().enumerate() {
            let min = frame.iter().cloned().fold(f64::INFINITY, f64::min);
            let max = frame.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let span = if max > min { max - min } else { 1.0 };

            for (y, &v) in frame.iter().enumerate() {
                let norm = ((v - min) / span * 255.0).clamp(0.0, 255.0) as u8;
                // write bottom-up so low bins are at bottom
                img.put_pixel(x as u32, height - 1 - y as u32, Luma([norm]));
            }
        }

        let mut png_bytes: Vec<u8> = Vec::new();
        {
            let encoder = image::codecs::png::PngEncoder::new(&mut png_bytes);
            use image::ImageEncoder;
            // Provide raw grayscale buffer and ColorType::L8
            // Use unwrap_or_else to maintain String return type while handling errors gracefully
            if let Err(e) = encoder.write_image(img.as_raw(), width, height, image::ColorType::L8) {
                // Log error but return empty string instead of panicking
                eprintln!("PNG encode failed: {}", e);
                return String::new();
            }
        }

        base64::engine::general_purpose::STANDARD.encode(png_bytes)
    }

}
