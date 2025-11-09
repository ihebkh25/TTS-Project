mod stream;
mod wav;
mod melspec;

use std::{collections::HashMap, fs, path::Path};

use anyhow::Context;
use base64::Engine; // for STANDARD.encode()
use hound;
use image::{ImageBuffer, Luma};
use mel_spec::prelude::*;
use ndarray::Array1;
use num_complex::Complex;
use piper_rs::synth::{PiperSpeechStreamParallel, PiperSpeechSynthesizer};
//use piper_rs::PiperError;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapEntry {
    pub config: String,
    pub default_speaker: Option<i64>,
}

#[derive(Debug)]
pub struct TtsManager {
    // language key -> (config path, default speaker)
    pub(crate) map: HashMap<String, (String, Option<i64>)>,
}

impl TtsManager {
    /// Create from a prebuilt map
    pub fn new(map: HashMap<String, (String, Option<i64>)>) -> Self {
        Self { map }
    }

    /// Load from `models/map.json`
    pub fn new_from_mapfile<P: AsRef<Path>>(p: P) -> anyhow::Result<Self> {
        let text = fs::read_to_string(p.as_ref())
            .with_context(|| format!("Failed to load {}", p.as_ref().display()))?;
        // Accept either { "de_DE": { "config": "...", "default_speaker": 0 }, ... }
        // OR legacy { "de_DE": "path.json", ... }
        let json: serde_json::Value = serde_json::from_str(&text)
            .with_context(|| "map.json is not valid JSON")?;

        let mut map: HashMap<String, (String, Option<i64>)> = HashMap::new();
        if let Some(obj) = json.as_object() {
            for (k, v) in obj {
                match v {
                    serde_json::Value::String(path) => {
                        map.insert(k.clone(), (path.clone(), None));
                    }
                    serde_json::Value::Object(o) => {
                        let config = o
                            .get("config")
                            .and_then(|x| x.as_str())
                            .ok_or_else(|| anyhow::anyhow!("missing 'config' for key {}", k))?
                            .to_string();
                        let spk = o.get("default_speaker").and_then(|x| x.as_i64());
                        map.insert(k.clone(), (config, spk));
                    }
                    _ => {
                        return Err(anyhow::anyhow!(
                            "invalid entry for key {} (expected string or object)",
                            k
                        ));
                    }
                }
            }
        } else {
            return Err(anyhow::anyhow!("map.json must be a JSON object"));
        }

        Ok(Self { map })
    }

    /// List supported language keys
    pub fn list_languages(&self) -> Vec<String> {
        self.map.keys().cloned().collect()
    }

    /// Iterate raw mapping (for /voices/detail)
    pub fn map_iter(&self) -> impl Iterator<Item = (&String, &(String, Option<i64>))> {
        self.map.iter()
    }

    /// Resolve config (and default speaker) for a language key
    pub fn config_for(&self, lang_opt: Option<&str>) -> anyhow::Result<(String, Option<i64>)> {
        // choose your preferred default here
        let lang = lang_opt.unwrap_or("de_DE");
        self.map
            .get(lang)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!(format!("Unknown language key: {lang}. Use /voices to list.")))
    }

    /// Build a Piper synthesizer from a config path
    pub fn build_synth<P: AsRef<Path>>(
        &self,
        cfg_path: P,
    ) -> anyhow::Result<PiperSpeechSynthesizer> {
        // piper-rs expects: piper_rs::from_config_path -> model -> PiperSpeechSynthesizer::new(model)?
        let model = piper_rs::from_config_path(cfg_path.as_ref())
            .map_err(|e| anyhow::anyhow!("piper load error: {e}"))?;
        Ok(PiperSpeechSynthesizer::new(model)?)
    }

    /// Legacy helper kept for compatibility (uses default speaker)
    pub fn synthesize_blocking(&self, text: &str, lang_opt: Option<&str>) -> anyhow::Result<Vec<f32>> {
        self.synthesize_with(text, lang_opt, None)
    }

    /// New: allow an optional speaker override
    pub fn synthesize_with(
        &self,
        text: &str,
        lang_opt: Option<&str>,
        speaker_override: Option<i64>,
    ) -> anyhow::Result<Vec<f32>> {
        let (cfg_path, default_speaker) = self.config_for(lang_opt)?;
        let _speaker_id = speaker_override.or(default_speaker);

        // If you later need to force speaker via SSML or tokens, do it here.
        let synth = self.build_synth(&cfg_path)?;
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

    /// Convenience: WAV base64
    pub fn encode_wav_base64(samples: &[f32], sample_rate: u32) -> anyhow::Result<String> {
        use std::io::Cursor;
        use base64::Engine; // enables `.encode(...)`

        let spec = hound::WavSpec {
            channels: 1,
            sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        // Write to a Cursor so we can recover the Vec<u8> afterwards
        let mut cursor = Cursor::new(Vec::<u8>::new());
        {
            let mut writer = hound::WavWriter::new(&mut cursor, spec)
                .map_err(|e| anyhow::anyhow!("wav write err: {e}"))?;

            for &s in samples {
                // clamp and convert f32 [-1.0, 1.0] -> i16
                let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
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
            encoder
                .write_image(img.as_raw(), width, height, image::ColorType::L8)
                .expect("PNG encode failed");
        }

        base64::engine::general_purpose::STANDARD.encode(png_bytes)
    }

}
