//! Streaming synthesis helpers.
//!
//! This module provides an API to generate audio and mel spectrogram
//! frames incrementally. Piper currently synthesizes an entire
//! utterance in one call. To support real-time visualization of
//! speech, we chunk the generated samples into overlapping windows
//! and compute a mel spectrogram frame for each chunk. Each
//! iteration yields a pair `(audio_chunk, mel_frame)`.

use async_stream::try_stream;
use futures_core::stream::Stream;
use mel_spec::prelude::*; // brings Spectrogram + MelSpectrogram into scope
use ndarray::Array1;
use num_complex::Complex;
use piper_rs::synth::PiperSpeechSynthesizer;

/// Stream synthesized speech and mel-spectrogram frames.
///
/// * `synth` – An initialized Piper synthesizer.
/// * `text` – The utterance to synthesize.
/// * `frame_size` – Number of samples in each FFT frame.
/// * `hop_size` – Number of samples between successive frames.
/// * `n_mels` – Number of mel bins to compute.
pub fn stream_speech(
    synth: PiperSpeechSynthesizer,
    text: String,
    frame_size: usize,
    hop_size: usize,
    n_mels: usize,
) -> impl Stream<Item = anyhow::Result<(Vec<f32>, Vec<f32>)>> {
    try_stream! {
        // 1) Synthesize the full utterance. Piper returns an iterator over chunks.
        let audio_iter = synth
            .synthesize_parallel(text, None)
            .map_err(|e| anyhow::anyhow!("synthesis error: {e}"))?;

        let mut samples: Vec<f32> = Vec::new();
        for part in audio_iter {
            let v = part.map_err(|e| anyhow::anyhow!("chunk error: {e}"))?.into_vec();
            samples.extend(v);
        }

        // 2) Prepare streaming STFT and mel filter bank.
        //    If you can read the true sample rate from `synth`, use that here.
        //    Piper voices are commonly 22050 Hz; we use that as a safe default.
        let sample_rate_hz_f64: f64 = 22_050.0;

        let mut stft = Spectrogram::new(frame_size, hop_size);
        let mut mel  = MelSpectrogram::new(frame_size, sample_rate_hz_f64, n_mels);

        // 3) Walk through samples in hops; yield (audio_chunk, mel_frame)
        let mut offset = 0;
        while offset + hop_size <= samples.len() {
            let slice = &samples[offset..offset + hop_size];

            // STFT: `stft.add` returns Option<Array1<Complex<f64>>>
            let mel_frame_f64: Vec<f64> = if let Some(fft_frame) = stft.add(slice) {
                // fft_frame items are Complex<f64> -> pass through
                let arr_f64: Array1<Complex<f64>> =
                    Array1::from_iter(fft_frame.into_iter().map(|c: Complex<f64>| c));

                // mel.add expects &Array1<Complex<f64>>
                let (data, _offset) = mel.add(&arr_f64).into_raw_vec_and_offset();
                data // Vec<f64>
            } else {
                // Not enough samples yet — emit a zero mel frame
                vec![0.0f64; n_mels]
            };

            // Convert mel frame to f32 to match the stream's Item type
            let mel_frame: Vec<f32> = mel_frame_f64.iter().copied().map(|v| v as f32).collect();

            // Audio chunk as Vec<f32>
            let chunk: Vec<f32> = slice.to_vec();

            // Yield the pair (audio_chunk, mel_frame)
            yield (chunk, mel_frame);

            offset += hop_size;
        }
    }
}
